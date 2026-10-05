import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LLMEvent } from '@portfolio/shared';
import { describe, expect, test } from 'vitest';
import { buildFixtureStack } from '../testing/fixture-stack.js';
import { run, type EvalCliDeps } from './eval-candidate.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DATASET = readFileSync(
  resolve(root, 'evals/retrieval/fixture.jsonl'),
  'utf8',
);
const NOW = new Date('2026-10-05T01:02:03.456Z');

const COMPLIANT: LLMEvent[] = [
  { type: 'delta', text: 'According to the sources [1].' },
  { type: 'usage', usage: { inputTokens: 800, outputTokens: 10 } },
  { type: 'done', stopReason: 'end' },
];
const NO_CITATIONS: LLMEvent[] = [
  { type: 'delta', text: 'Trust me.' },
  { type: 'done', stopReason: 'end' },
];

async function harness(
  events: readonly LLMEvent[] = COMPLIANT,
  extra: Partial<EvalCliDeps> = {},
) {
  const stack = await buildFixtureStack(events);
  const index = stack.built.indexName;
  const files = new Map<string, string>([
    ['evals/retrieval/golden.jsonl', DATASET],
    [
      `evals/indexes/${index}.json`,
      JSON.stringify({
        indexName: index,
        manifestSha256: stack.built.manifestSha256,
      }),
    ],
  ]);
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, string>();
  const calls = { connect: 0 };
  const deps: EvalCliDeps = {
    readFile: (path) => files.get(path),
    writeFile: (path, content) => void written.set(path, content),
    now: () => NOW,
    gitSha: () => 'abc123def456',
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    connect: () => {
      calls.connect++;
      return Promise.resolve({
        service: stack.service,
        provider: stack.provider,
        config: { ...stack.config, activeIndex: 'none' },
      });
    },
    ...extra,
  };
  return { deps, out, err, written, files, index, stack, calls };
}

describe('eval-candidate CLI', () => {
  test('a passing run writes a report named for the index and the time, and exits 0', async () => {
    const h = await harness();
    expect(await run(['--index', h.index], h.deps)).toBe(0);
    expect([...h.written.keys()]).toEqual([
      `evals/reports/${h.index}-20261005T010203Z.json`,
    ]);
    const report = JSON.parse([...h.written.values()][0] ?? '{}') as {
      index: string;
      manifestSha256: string;
      gitSha: string;
      llmConfig: string;
      passed: boolean;
      createdAt: string;
    };
    expect(report).toMatchObject({
      index: h.index,
      manifestSha256: h.stack.built.manifestSha256,
      gitSha: 'abc123def456',
      passed: true,
      createdAt: '2026-10-05T01:02:03.456Z',
    });
    // The model config is recorded canonically so a later model change invalidates the report.
    expect(report.llmConfig).toBe(
      '{"model":"us.anthropic.claude-haiku-4-5-20251001-v1:0","provider":"bedrock-runtime"}',
    );
  });

  test('evaluates the named candidate, not whatever index the live config points at', async () => {
    const h = await harness();
    await run(['--index', h.index], h.deps);
    const report = JSON.parse([...h.written.values()][0] ?? '{}') as {
      index: string;
    };
    expect(report.index).toBe(h.index);
  });

  test('a failing run still writes its report (for the record) but exits 1', async () => {
    const h = await harness(NO_CITATIONS);
    expect(await run(['--index', h.index], h.deps)).toBe(1);
    const report = JSON.parse([...h.written.values()][0] ?? '{}') as {
      passed: boolean;
      failures: string[];
    };
    expect(report.passed).toBe(false);
    expect(report.failures).toContain('citationsValid');
    expect(h.err.join('\n')).toContain('no_valid_citation');
  });

  test('the report and the console output carry no answer text', async () => {
    const h = await harness();
    await run(['--index', h.index], h.deps);
    const all = [...h.written.values(), ...h.out, ...h.err].join('\n');
    expect(all).not.toContain('According to the sources');
  });

  test('--smoke runs three cases, writes no report, and says it cannot promote', async () => {
    const h = await harness();
    expect(await run(['--index', h.index, '--smoke'], h.deps)).toBe(0);
    expect(h.written.size).toBe(0);
    expect(h.stack.provider.requests).toHaveLength(2);
    expect(JSON.parse(h.out[0] ?? '{}')).toMatchObject({ cases: 3 });
    expect(h.out.join('\n')).toContain('cannot be used to promote');
  });

  test('refuses to start without the eval role, before reading the dataset result or writing anything', async () => {
    const h = await harness(COMPLIANT, {
      connect: () => Promise.reject(new Error('wrong role RAW')),
    });
    expect(await run(['--index', h.index], h.deps)).toBe(1);
    expect(h.written.size).toBe(0);
    expect(h.err.join('\n')).toContain('portfolio-v2-prod-eval');
    expect(h.err.join('\n')).not.toContain('RAW');
  });

  test.each([
    [['--index', 'none']],
    [['--index', 'chunks-short']],
    [[]],
    [['--index', 'chunks-0123456789abcdef', '--force']],
  ])(
    'rejects bad arguments %j with a usage error and no connection',
    async (argv) => {
      const h = await harness();
      expect(await run(argv, h.deps)).toBe(2);
      expect(h.calls.connect).toBe(0);
    },
  );

  test('a gated run needs the manifest the ingest tool wrote', async () => {
    const h = await harness();
    h.files.delete(`evals/indexes/${h.index}.json`);
    expect(await run(['--index', h.index], h.deps)).toBe(1);
    expect(h.calls.connect).toBe(0);
    expect(h.err.join('\n')).toContain('ingest it first');
  });

  test('a manifest that does not match the index name is refused', async () => {
    const h = await harness();
    h.files.set(
      `evals/indexes/${h.index}.json`,
      JSON.stringify({ manifestSha256: 'f'.repeat(64) }),
    );
    expect(await run(['--index', h.index], h.deps)).toBe(1);
    expect(h.calls.connect).toBe(0);
  });

  test('a missing or invalid dataset is an error before any connection', async () => {
    const h = await harness();
    h.files.delete('evals/retrieval/golden.jsonl');
    expect(await run(['--index', h.index], h.deps)).toBe(1);
    h.files.set('evals/retrieval/golden.jsonl', 'not json');
    expect(await run(['--index', h.index], h.deps)).toBe(1);
    expect(h.calls.connect).toBe(0);
  });
});
