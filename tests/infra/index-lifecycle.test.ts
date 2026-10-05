import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { DEFAULT_TTL_MS } from '../../apps/api/src/core/config/cached-config.ts';
import {
  ACTIVE_PARAMETER,
  LLM_PARAMETER,
  VECTOR_BUCKET,
  run,
  type LifecycleIo,
} from '../../infra/scripts/index-lifecycle.ts';
import {
  INDEX_NAME,
  KEEP_PREVIOUS,
  PRUNE_GRACE_MS,
  RECENT_INDEX_MS,
  REPORT_MAX_AGE_MS,
  canonicalJson,
  checkCandidate,
  defaultRollbackTarget,
  parseHistory,
  planPrune,
  retention,
  verifyReport,
  wroteExpectedVersion,
  type HistoryEntry,
  type IndexSummary,
} from '../../infra/scripts/index-lifecycle-lib.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-10T12:00:00Z');
const name = (n: number): string =>
  `chunks-${n.toString(16).padStart(16, '0')}`;
const [A, B, C, D, E] = [1, 2, 3, 4, 5].map(name) as [
  string,
  string,
  string,
  string,
  string,
];
const entry = (
  version: number,
  value: string,
  hoursAgo: number,
): HistoryEntry => ({
  version,
  value,
  modifiedAt: NOW - hoursAgo * HOUR,
});

describe('retention rules', () => {
  test('the active index plus the previous two are retained, most recent first', () => {
    const r = retention(
      [
        entry(1, 'none', 100),
        entry(2, A, 90),
        entry(3, B, 80),
        entry(4, C, 70),
        entry(5, D, 60),
      ],
      NOW,
    );
    expect(r).toMatchObject({ active: D, previous: [C, B] });
    expect(KEEP_PREVIOUS).toBe(2);
  });

  test('none is never a rollback target, and a repeated value counts once', () => {
    const r = retention(
      [entry(1, A, 90), entry(2, B, 80), entry(3, A, 70), entry(4, none(), 60)],
      NOW,
    );
    expect(r.active).toBe('none');
    expect(r.previous).toEqual([A, B]);
    function none() {
      return 'none';
    }
  });

  test('a value that was live within the grace window is kept even beyond the previous two', () => {
    const justNow = (minutes: number): number => NOW - minutes * 60_000;
    const h: HistoryEntry[] = [
      { version: 1, value: A, modifiedAt: NOW - 100 * HOUR },
      { version: 2, value: B, modifiedAt: NOW - 90 * HOUR },
      { version: 3, value: C, modifiedAt: NOW - 80 * HOUR },
      { version: 4, value: D, modifiedAt: justNow(20) },
      { version: 5, value: E, modifiedAt: justNow(5) },
    ];
    const r = retention(h, NOW);
    expect(r.previous).toEqual([D, C]);
    expect(r.grace).toEqual([D]);
    // B and A stopped being live long ago and are not retained.
    expect(r.grace).not.toContain(B);
  });

  test('the grace window is longer than the config cache plus the function timeout (TTL tested)', () => {
    const limits = JSON.parse(
      readFileSync(resolve(root, 'infra/modules/ssm/parameters.json'), 'utf8'),
    ).parameters.limits.default as { timeoutSeconds: number };
    const slowestStaleReader =
      DEFAULT_TTL_MS + (limits.timeoutSeconds + 5) * 1000;
    expect(PRUNE_GRACE_MS).toBeGreaterThan(slowestStaleReader);
  });
});

describe('parseHistory (fails closed)', () => {
  const doc = (parameters: unknown[]) =>
    JSON.stringify({ Parameters: parameters });
  const item = (Version: number, Value: string, LastModifiedDate: unknown) => ({
    Version,
    Value,
    LastModifiedDate,
  });

  test('reads epoch seconds and ISO strings, and sorts by version', () => {
    const h = parseHistory(
      doc([
        item(2, B, '2026-10-10T10:00:00.123000+00:00'),
        item(1, A, 1_790_000_000.5),
      ]),
    );
    expect(h.map((e) => e.version)).toEqual([1, 2]);
    expect(h[0]?.modifiedAt).toBe(1_790_000_000_500);
    expect(h[1]?.modifiedAt).toBe(Date.parse('2026-10-10T10:00:00.123Z'));
  });

  test.each([
    ['not JSON', 'nope'],
    ['no parameters', '{}'],
    ['an empty list', doc([])],
    ['a value that is not an index name', doc([item(1, 'prod', 1)])],
    ['a path-like value', doc([item(1, '../chunks-0123456789abcdef', 1)])],
    ['a bad version', doc([item(1.5, A, 1)])],
    ['an unreadable timestamp', doc([item(1, A, 'yesterday-ish')])],
  ])('rejects %s', (_label, text) => {
    expect(() => parseHistory(text)).toThrow();
  });
});

// A small seeded generator so the property test is the same on every run.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('planPrune never selects what must be kept', () => {
  test('property: across 2,000 random histories and bucket contents', () => {
    const rand = mulberry32(20261010);
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(rand() * items.length)] as T;
    const pool = Array.from({ length: 8 }, (_, i) => name(i + 1));
    let deletions = 0;

    for (let round = 0; round < 2000; round++) {
      const length = 1 + Math.floor(rand() * 8);
      let at = NOW - (20 + rand() * 400) * HOUR;
      const history: HistoryEntry[] = [];
      for (let v = 1; v <= length; v++) {
        // Changes are sometimes minutes apart and sometimes days apart, so the grace window is exercised.
        at += rand() < 0.3 ? rand() * 20 * 60_000 : rand() * 60 * HOUR;
        history.push({
          version: v,
          value: rand() < 0.15 ? 'none' : pick(pool),
          modifiedAt: Math.min(at, NOW - 1000),
        });
      }
      const present = new Set<string>(pool.filter(() => rand() < 0.8));
      const active = history.at(-1)!.value;
      if (active !== 'none') present.add(active);
      const indexes: IndexSummary[] = [
        ...[...present].map((n) => ({
          name: n,
          createdAt: NOW - rand() * 300 * HOUR,
        })),
        // Names this tool does not own must never be touched.
        { name: 'chunks-OTHER', createdAt: NOW - 500 * HOUR },
        { name: 'dsmm-portfolio-index', createdAt: NOW - 500 * HOUR },
      ];

      const plan = planPrune(indexes, history, NOW);
      const r = retention(history, NOW);
      const byName = new Map(indexes.map((i) => [i.name, i]));
      for (const doomed of plan.delete) {
        deletions++;
        expect(INDEX_NAME.test(doomed), 'only our index names').toBe(true);
        expect(doomed, 'never the active index').not.toBe(active);
        expect(r.previous, 'never a rollback target').not.toContain(doomed);
        expect(r.grace, 'never recently live').not.toContain(doomed);
        expect(
          NOW - byName.get(doomed)!.createdAt,
          'never a recent candidate',
        ).toBeGreaterThanOrEqual(RECENT_INDEX_MS);
      }
      // Everything is either kept (with a reason) or deleted, exactly once.
      expect(plan.delete.length + plan.keep.length).toBe(indexes.length);
    }
    // The property is only meaningful if the generator actually produced deletions.
    expect(deletions).toBeGreaterThan(500);
  });

  test('refuses without history, and when the active index is not in the bucket', () => {
    expect(() => planPrune([{ name: A, createdAt: 0 }], [], NOW)).toThrow();
    expect(() =>
      planPrune([{ name: B, createdAt: 0 }], [entry(1, A, 50)], NOW),
    ).toThrow(/active index is not in the bucket/);
  });

  test('with no active index it can prune old indexes but keeps the rollback targets', () => {
    const h = [
      entry(1, A, 90),
      entry(2, B, 80),
      entry(3, C, 70),
      entry(4, 'none', 60),
    ];
    const plan = planPrune(
      [A, B, C, D].map((n) => ({ name: n, createdAt: NOW - 200 * HOUR })),
      h,
      NOW,
    );
    expect([...plan.delete].sort()).toEqual([A, D].sort());
    expect(plan.keep.map((k) => k.reason)).toEqual([
      'retained for rollback',
      'retained for rollback',
    ]);
  });
});

describe('verifyReport', () => {
  const llm = canonicalJson({ provider: 'bedrock-runtime', model: 'm' });
  const expected = {
    candidate: A,
    manifestSha256: 'a'.repeat(64),
    llmConfig: llm,
    now: NOW,
  };
  const good = {
    schema: 1,
    passed: true,
    index: A,
    manifestSha256: 'a'.repeat(64),
    llmConfig: llm,
    createdAt: new Date(NOW - HOUR).toISOString(),
  };

  test('accepts a passing, recent report for this build and model', () => {
    expect(verifyReport(good, expected)).toEqual([]);
  });

  test.each([
    ['a failed gate', { passed: false }, 'the report did not pass'],
    ['another index', { index: B }, 'the report is for a different index'],
    [
      'another build',
      { manifestSha256: 'b'.repeat(64) },
      'the report is for a different build of this index',
    ],
    [
      'another model config',
      { llmConfig: '{}' },
      'the model configuration has changed since the report',
    ],
    [
      'a stale report',
      { createdAt: new Date(NOW - REPORT_MAX_AGE_MS - 1000).toISOString() },
      'the report is older than 24 hours',
    ],
    [
      'a future report',
      { createdAt: new Date(NOW + HOUR).toISOString() },
      'the report is dated in the future',
    ],
    ['no time', { createdAt: 'whenever' }, 'the report has no valid time'],
    ['another schema', { schema: 2 }, 'unsupported report schema'],
  ])('refuses %s', (_label, change, problem) => {
    expect(verifyReport({ ...good, ...change }, expected)).toContain(problem);
  });

  test('refuses anything that is not an object', () => {
    for (const bad of [null, undefined, 'x', 7, []]) {
      expect(verifyReport(bad, expected).length).toBeGreaterThan(0);
    }
  });
});

describe('checkCandidate and helpers', () => {
  const manifest = { manifestSha256: 'a'.repeat(64), keyCount: 12 };
  const ok = {
    exists: true,
    complete: true,
    manifestSha256: 'a'.repeat(64),
    keyCount: 12,
  };

  test('accepts a complete index that holds exactly the manifest', () => {
    expect(checkCandidate(A, ok, manifest, B)).toEqual([]);
  });

  test.each([
    [
      'a missing index',
      { ...ok, exists: false },
      'the candidate index does not exist',
    ],
    [
      'an incomplete index',
      { ...ok, complete: false },
      'the candidate is not tagged complete',
    ],
    [
      'a different manifest',
      { ...ok, manifestSha256: 'f'.repeat(64) },
      'the index tags a different manifest than the one on disk',
    ],
    [
      'extra or missing vectors',
      { ...ok, keyCount: 11 },
      "the index does not hold exactly the manifest's chunks",
    ],
  ])('refuses %s', (_label, state, problem) => {
    expect(checkCandidate(A, state, manifest, B)).toContain(problem);
  });

  test('refuses the active index and a malformed name', () => {
    expect(checkCandidate(A, ok, manifest, A)).toContain(
      'the candidate is already the active index',
    );
    expect(checkCandidate('chunks-x', ok, manifest, A)).toEqual([
      'the candidate is not a chunks-<16 hex> index name',
    ]);
  });

  test('the rollback target defaults to the most recent previous index, never none', () => {
    expect(defaultRollbackTarget([entry(1, A, 30), entry(2, B, 20)], NOW)).toBe(
      A,
    );
    expect(
      defaultRollbackTarget([entry(1, 'none', 30), entry(2, B, 20)], NOW),
    ).toBeUndefined();
  });

  test('a write is accepted only as exactly the next parameter version', () => {
    expect(wroteExpectedVersion(7, 8)).toBe(true);
    expect(wroteExpectedVersion(7, 9)).toBe(false);
    expect(wroteExpectedVersion(7, 7)).toBe(false);
  });

  test('canonicalJson orders keys and omits whitespace', () => {
    expect(
      canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } }),
    ).toBe('{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
  });
});

// A simulated AWS: SSM parameters with history, and a vector bucket with tagged indexes.
function simulate(options: {
  history: { value: string; hoursAgo: number }[];
  llm?: string;
  indexes: Record<
    string,
    { hoursOld: number; tags?: Record<string, string>; keys?: number }
  >;
  files?: Record<string, string>;
}) {
  const history = options.history.map((h, i) => ({
    Version: i + 1,
    Value: h.value,
    LastModifiedDate: (NOW - h.hoursAgo * HOUR) / 1000,
  }));
  const deleted: string[] = [];
  const puts: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[][] = [];
  let intercept: (() => void) | undefined;
  const files = new Map(Object.entries(options.files ?? {}));
  const llm =
    options.llm ?? JSON.stringify({ provider: 'bedrock-runtime', model: 'm' });

  const arnOf = (n: string) =>
    `arn:aws:s3vectors:us-east-1:123456789012:bucket/${VECTOR_BUCKET}/index/${n}`;
  const arg = (args: readonly string[], flag: string) =>
    args[args.indexOf(flag) + 1] ?? '';

  const io: LifecycleIo = {
    aws: (args) => {
      calls.push([...args]);
      const [service, command] = args;
      if (service === 'ssm' && command === 'get-parameter') {
        const n = arg(args, '--name');
        if (n === LLM_PARAMETER)
          return JSON.stringify({ Parameter: { Value: llm, Version: 1 } });
        if (n === ACTIVE_PARAMETER) {
          intercept?.();
          const last = history.at(-1)!;
          return JSON.stringify({
            Parameter: { Value: last.Value, Version: last.Version },
          });
        }
      }
      if (service === 'ssm' && command === 'get-parameter-history')
        return JSON.stringify({ Parameters: history });
      if (service === 'ssm' && command === 'put-parameter') {
        const value = arg(args, '--value');
        puts.push(value);
        history.push({
          Version: history.length + 1,
          Value: value,
          LastModifiedDate: NOW / 1000,
        });
        return JSON.stringify({ Version: history.length });
      }
      if (service === 's3vectors' && command === 'list-indexes') {
        return JSON.stringify({
          indexes: Object.entries(options.indexes).map(([n, i]) => ({
            indexName: n,
            indexArn: arnOf(n),
            creationTime: (NOW - i.hoursOld * HOUR) / 1000,
          })),
        });
      }
      if (service === 's3vectors' && command === 'list-tags-for-resource') {
        const n = arg(args, '--resource-arn').split('/').pop() ?? '';
        return JSON.stringify({ tags: options.indexes[n]?.tags ?? {} });
      }
      if (service === 's3vectors' && command === 'list-vectors') {
        const n = arg(args, '--index-name');
        return JSON.stringify({
          vectors: Array.from(
            { length: options.indexes[n]?.keys ?? 0 },
            (_, i) => ({ key: `k${i}` }),
          ),
        });
      }
      if (service === 's3vectors' && command === 'delete-index') {
        const n = arg(args, '--index-name');
        deleted.push(n);
        delete options.indexes[n];
        return '{}';
      }
      throw new Error(`unexpected aws call: ${args.join(' ')}`);
    },
    readFile: (path) => files.get(path),
    now: () => NOW,
    out: (l) => void out.push(l),
    err: (l) => void err.push(l),
  };
  return {
    io,
    history,
    deleted,
    puts,
    out,
    err,
    calls,
    files,
    onActiveRead: (fn: () => void) => (intercept = fn),
  };
}

const COMPLETE = (sha: string) => ({
  IngestStatus: 'complete',
  ManifestSha256: sha,
});
const SHA = 'a'.repeat(64);
const manifestFile = (index: string) =>
  JSON.stringify({
    indexName: index,
    manifestSha256: SHA,
    manifest: { sources: [{ chunks: [{}, {}, {}] }, { chunks: [{}, {}] }] },
  });
const reportFile = (index: string, extra: object = {}) =>
  JSON.stringify({
    schema: 1,
    passed: true,
    index,
    manifestSha256: SHA,
    llmConfig: canonicalJson({ provider: 'bedrock-runtime', model: 'm' }),
    createdAt: new Date(NOW - HOUR).toISOString(),
    ...extra,
  });

describe('index-lifecycle promote', () => {
  const setup = (
    overrides: Partial<Parameters<typeof simulate>[0]> = {},
    report = reportFile(B),
  ) =>
    simulate({
      history: [
        { value: 'none', hoursAgo: 100 },
        { value: A, hoursAgo: 50 },
      ],
      indexes: {
        [A]: { hoursOld: 60, tags: COMPLETE('c'.repeat(64)), keys: 4 },
        [B]: { hoursOld: 2, tags: COMPLETE(SHA), keys: 5 },
      },
      files: {
        [`evals/indexes/${B}.json`]: manifestFile(B),
        'evals/reports/r.json': report,
      },
      ...overrides,
    });

  test('is a dry run by default: it checks everything and changes nothing', () => {
    const s = setup();
    expect(
      run(
        ['promote', '--candidate', B, '--report', 'evals/reports/r.json'],
        s.io,
      ),
    ).toBe(0);
    expect(s.puts).toEqual([]);
    expect(s.out.join('\n')).toContain('dry run');
  });

  test('--apply writes exactly the candidate, once, and tells the operator to wait', () => {
    const s = setup();
    expect(
      run(
        [
          'promote',
          '--candidate',
          B,
          '--report',
          'evals/reports/r.json',
          '--apply',
        ],
        s.io,
      ),
    ).toBe(0);
    expect(s.puts).toEqual([B]);
    expect(s.out.join('\n')).toContain('35 seconds');
    expect(s.out.join('\n')).toContain(A);
  });

  test.each([
    [
      'a failed report',
      reportFile(B, { passed: false }),
      'the report did not pass',
    ],
    [
      'a report for another build',
      reportFile(B, { manifestSha256: 'b'.repeat(64) }),
      'different build',
    ],
    [
      'a report from a different model config',
      reportFile(B, { llmConfig: '{}' }),
      'model configuration has changed',
    ],
  ])('refuses %s and writes nothing', (_label, report, text) => {
    const s = setup({}, report);
    expect(
      run(
        [
          'promote',
          '--candidate',
          B,
          '--report',
          'evals/reports/r.json',
          '--apply',
        ],
        s.io,
      ),
    ).toBe(1);
    expect(s.puts).toEqual([]);
    expect(s.err.join('\n')).toContain(text);
  });

  test('refuses an incomplete candidate and one with the wrong number of vectors', () => {
    const incomplete = setup({
      indexes: {
        [A]: { hoursOld: 60, tags: COMPLETE('c'.repeat(64)), keys: 4 },
        [B]: {
          hoursOld: 2,
          tags: { IngestStatus: 'pending', ManifestSha256: SHA },
          keys: 5,
        },
      },
    });
    expect(
      run(
        [
          'promote',
          '--candidate',
          B,
          '--report',
          'evals/reports/r.json',
          '--apply',
        ],
        incomplete.io,
      ),
    ).toBe(1);
    const wrongCount = setup({
      indexes: {
        [A]: { hoursOld: 60, tags: COMPLETE('c'.repeat(64)), keys: 4 },
        [B]: { hoursOld: 2, tags: COMPLETE(SHA), keys: 4 },
      },
    });
    expect(
      run(
        [
          'promote',
          '--candidate',
          B,
          '--report',
          'evals/reports/r.json',
          '--apply',
        ],
        wrongCount.io,
      ),
    ).toBe(1);
    expect(incomplete.puts.concat(wrongCount.puts)).toEqual([]);
  });

  test('refuses without a manifest or a report file', () => {
    const noManifest = setup({
      files: { 'evals/reports/r.json': reportFile(B) },
    });
    expect(
      run(
        [
          'promote',
          '--candidate',
          B,
          '--report',
          'evals/reports/r.json',
          '--apply',
        ],
        noManifest.io,
      ),
    ).toBe(1);
    const noReport = setup({
      files: { [`evals/indexes/${B}.json`]: manifestFile(B) },
    });
    expect(
      run(
        [
          'promote',
          '--candidate',
          B,
          '--report',
          'evals/reports/r.json',
          '--apply',
        ],
        noReport.io,
      ),
    ).toBe(1);
    expect(noManifest.puts.concat(noReport.puts)).toEqual([]);
  });

  test('aborts, writing nothing, if the parameter changes while the command runs', () => {
    const s = setup();
    let reads = 0;
    s.onActiveRead(() => {
      // The third read of active_index is the re-check just before the write: someone promoted in between.
      if (++reads === 2)
        s.history.push({
          Version: s.history.length + 1,
          Value: C,
          LastModifiedDate: NOW / 1000,
        });
    });
    expect(
      run(
        [
          'promote',
          '--candidate',
          B,
          '--report',
          'evals/reports/r.json',
          '--apply',
        ],
        s.io,
      ),
    ).toBe(1);
    expect(s.puts).toEqual([]);
    expect(s.err.join('\n')).toContain(
      'changed while this command was running',
    );
  });

  test('refuses malformed arguments without any AWS call', () => {
    const s = setup();
    expect(run(['promote', '--candidate', 'none', '--report', 'x'], s.io)).toBe(
      2,
    );
    expect(run(['promote', '--candidate', B], s.io)).toBe(2);
    expect(s.calls).toEqual([]);
  });
});

describe('index-lifecycle rollback', () => {
  const setup = () =>
    simulate({
      history: [
        { value: A, hoursAgo: 80 },
        { value: B, hoursAgo: 40 },
      ],
      indexes: {
        [A]: { hoursOld: 90, tags: COMPLETE(SHA), keys: 5 },
        [B]: { hoursOld: 50, tags: COMPLETE(SHA), keys: 5 },
      },
    });

  test('is a dry run by default and then goes back to the previous index', () => {
    const s = setup();
    expect(run(['rollback'], s.io)).toBe(0);
    expect(s.puts).toEqual([]);
    expect(run(['rollback', '--apply'], s.io)).toBe(0);
    expect(s.puts).toEqual([A]);
  });

  test('refuses a target that is missing or incomplete, and the value that is already active', () => {
    const s = setup();
    expect(run(['rollback', '--to', C, '--apply'], s.io)).toBe(1);
    expect(run(['rollback', '--to', B, '--apply'], s.io)).toBe(1);
    expect(s.puts).toEqual([]);
  });

  test('switching retrieval off needs an explicit --to none', () => {
    const s = simulate({
      history: [
        { value: 'none', hoursAgo: 80 },
        { value: B, hoursAgo: 40 },
      ],
      indexes: { [B]: { hoursOld: 50, tags: COMPLETE(SHA), keys: 5 } },
    });
    expect(run(['rollback', '--apply'], s.io)).toBe(1);
    expect(s.puts).toEqual([]);
    expect(run(['rollback', '--to', 'none', '--apply'], s.io)).toBe(0);
    expect(s.puts).toEqual(['none']);
  });
});

describe('index-lifecycle prune', () => {
  const setup = () =>
    simulate({
      history: [
        { value: A, hoursAgo: 400 },
        { value: B, hoursAgo: 300 },
        { value: C, hoursAgo: 200 },
        { value: D, hoursAgo: 100 },
      ],
      indexes: {
        [A]: { hoursOld: 500, tags: COMPLETE(SHA), keys: 5 },
        [B]: { hoursOld: 450, tags: COMPLETE(SHA), keys: 5 },
        [C]: { hoursOld: 350, tags: COMPLETE(SHA), keys: 5 },
        [D]: { hoursOld: 250, tags: COMPLETE(SHA), keys: 5 },
        [E]: { hoursOld: 1, tags: { IngestStatus: 'pending' }, keys: 1 },
      },
    });

  test('a dry run lists the plan and deletes nothing', () => {
    const s = setup();
    expect(run(['prune'], s.io)).toBe(0);
    expect(s.deleted).toEqual([]);
    expect(s.out.join('\n')).toContain('dry run');
  });

  test('--apply deletes only the indexes older than the active one and the previous two', () => {
    const s = setup();
    expect(run(['prune', '--apply'], s.io)).toBe(0);
    // Active D, previous C and B are kept; E is a fresh candidate; only A goes.
    expect(s.deleted).toEqual([A]);
  });

  test('fails closed when the history cannot be read', () => {
    const s = setup();
    const real = s.io.aws;
    const io: LifecycleIo = {
      ...s.io,
      aws: (args) =>
        args[1] === 'get-parameter-history' ? '{"Parameters":[]}' : real(args),
    };
    expect(run(['prune', '--apply'], io)).toBe(1);
    expect(s.deleted).toEqual([]);
  });

  test('re-plans before each delete and skips one that became protected', () => {
    const s = setup();
    let listings = 0;
    const real = s.io.aws;
    const io: LifecycleIo = {
      ...s.io,
      aws: (args) => {
        if (args[1] === 'list-indexes' && ++listings === 2) {
          // Between the plan and the delete, A is promoted again.
          s.history.push({
            Version: s.history.length + 1,
            Value: A,
            LastModifiedDate: NOW / 1000,
          });
        }
        return real(args);
      },
    };
    expect(run(['prune', '--apply'], io)).toBe(0);
    expect(s.deleted).toEqual([]);
    expect(s.err.join('\n')).toContain('no longer safe');
  });
});

describe('index-lifecycle status and usage', () => {
  test('status reports the active index, the retained ones, and completion', () => {
    const s = simulate({
      history: [
        { value: A, hoursAgo: 80 },
        { value: B, hoursAgo: 40 },
      ],
      indexes: {
        [A]: { hoursOld: 90, tags: COMPLETE(SHA), keys: 5 },
        [B]: { hoursOld: 50, tags: {}, keys: 5 },
      },
    });
    expect(run(['status'], s.io)).toBe(0);
    const parsed = JSON.parse(s.out[0] ?? '{}') as {
      active: string;
      previous: string[];
      indexes: { name: string; complete: boolean }[];
    };
    expect(parsed.active).toBe(B);
    expect(parsed.previous).toEqual([A]);
    expect(parsed.indexes.find((i) => i.name === A)?.complete).toBe(true);
    expect(parsed.indexes.find((i) => i.name === B)?.complete).toBe(false);
  });

  test('an unknown command or flag is a usage error with no AWS call', () => {
    const s = simulate({ history: [{ value: A, hoursAgo: 1 }], indexes: {} });
    expect(run(['delete-everything'], s.io)).toBe(2);
    expect(run(['status', '--bucket', 'other'], s.io)).toBe(2);
    expect(run([], s.io)).toBe(2);
    expect(s.calls).toEqual([]);
  });

  test('the script can only name the portfolio-v2 parameter and bucket', () => {
    expect(ACTIVE_PARAMETER.startsWith('/portfolio-v2/')).toBe(true);
    expect(LLM_PARAMETER.startsWith('/portfolio-v2/')).toBe(true);
    expect(VECTOR_BUCKET.startsWith('portfolio-v2-')).toBe(true);
  });
});
