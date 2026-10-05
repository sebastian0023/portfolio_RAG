import type { Embedder, EmbedResult } from '@portfolio/shared';
import { EMBEDDING_CONFIG } from '@portfolio/shared';
import { describe, expect, test, vi } from 'vitest';
import {
  FIXTURE_OPTIONS,
  fixtureCorpusFiles,
} from '../../testing/fixture-corpus.js';
import { FakeEmbedder } from '../../testing/fake-embedder.js';
import { FakeIndexAdmin } from '../../testing/fake-index-admin.js';
import { loadCorpus } from './corpus.js';
import { isAssumedRole } from './identity.js';
import {
  INGEST_CAPS,
  planIngestion,
  runIngestion,
  type IngestCaps,
  type IngestDeps,
} from './ingest.js';

const loaded = loadCorpus(fixtureCorpusFiles(), FIXTURE_OPTIONS);
if (!loaded.ok) throw new Error('fixture corpus must load');
const { built, chunks } = loaded;
const ACTIVE = 'chunks-aaaaaaaaaaaaaaaa';

// A clock that only moves when a sleep happens, so pacing is observable and tests run instantly.
function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number): Promise<void> => {
      t += ms;
      return Promise.resolve();
    },
    sleeps: [] as number[],
  };
}

function setup(
  overrides: Partial<IngestDeps> = {},
  embedder: Embedder = new FakeEmbedder(),
) {
  const admin = new FakeIndexAdmin();
  const c = clock();
  const deps: IngestDeps = {
    admin,
    embedder,
    repository: admin,
    activeIndex: () => Promise.resolve(ACTIVE),
    now: c.now,
    sleep: (ms) => {
      c.sleeps.push(ms);
      return c.sleep(ms);
    },
    random: () => 0,
    ...overrides,
  };
  return { admin, deps, clock: c };
}

const caps = (extra: Partial<IngestCaps> = {}): IngestCaps => ({
  ...INGEST_CAPS,
  ...extra,
});

describe('planIngestion', () => {
  test('estimates tokens and cost and checks the caps', () => {
    const plan = planIngestion(built, chunks);
    expect(plan).toMatchObject({
      indexName: built.indexName,
      chunks: chunks.length,
      withinCaps: true,
    });
    expect(plan.estimatedTokens).toBeGreaterThan(chunks.length);
    expect(plan.estimatedCostUsd).toBeLessThan(0.01);
    expect(
      planIngestion(built, chunks, caps({ maxChunks: 3 })).withinCaps,
    ).toBe(false);
    expect(
      planIngestion(built, chunks, caps({ maxEstimatedTokens: 10 })).withinCaps,
    ).toBe(false);
  });
});

describe('runIngestion', () => {
  test('builds, verifies, and completes a new index', async () => {
    const { admin, deps } = setup();
    const result = await runIngestion(deps, built, chunks);
    expect(result).toEqual({
      ok: true,
      action: 'created',
      indexName: built.indexName,
      chunks: chunks.length,
      embedCalls: chunks.length,
    });
    const stored = admin.indexes.get(built.indexName);
    expect(stored?.complete).toBe(true);
    expect(stored?.sha).toBe(built.manifestSha256);
    expect(stored?.records.size).toBe(chunks.length);
  });

  test('a second run does nothing: no embeds, no writes (idempotent)', async () => {
    const embedder = new FakeEmbedder();
    const { admin, deps } = setup({}, embedder);
    await runIngestion(deps, built, chunks);
    const embedsBefore = embedder.calls();
    const putsBefore = admin.calls.put;
    const again = await runIngestion(deps, built, chunks);
    expect(again).toMatchObject({ ok: true, action: 'noop', embedCalls: 0 });
    expect(embedder.calls()).toBe(embedsBefore);
    expect(admin.calls.put).toBe(putsBefore);
    expect(admin.calls.create).toBe(1);
  });

  test('a failure mid-write leaves the index incomplete, and a re-run finishes it', async () => {
    const embedder = new FakeEmbedder();
    const { admin, deps } = setup({}, embedder);
    admin.failPutNumber = 2;
    const first = await runIngestion(
      deps,
      built,
      chunks,
      caps({ putBatch: 3 }),
    );
    expect(first).toMatchObject({ ok: false, reason: 'admin_failed' });
    expect(JSON.stringify(first)).not.toContain('RAW-ADMIN-DETAIL');
    const partial = admin.indexes.get(built.indexName);
    expect(partial?.complete).toBe(false);
    expect(partial?.records.size).toBe(3);

    const second = await runIngestion(
      deps,
      built,
      chunks,
      caps({ putBatch: 3 }),
    );
    expect(second).toMatchObject({ ok: true, action: 'resumed' });
    // Only the chunks that were missing are embedded again (plus none for the probe: it was embedded last time).
    expect(second.ok && second.embedCalls).toBeGreaterThanOrEqual(
      chunks.length - 3,
    );
    expect(second.ok && second.embedCalls).toBeLessThan(chunks.length);
    expect(admin.indexes.get(built.indexName)?.complete).toBe(true);
    expect(admin.indexes.get(built.indexName)?.records.size).toBe(
      chunks.length,
    );
  });

  test('makes no call at all when the corpus is over the caps', async () => {
    const embedder = new FakeEmbedder();
    const { admin, deps } = setup({}, embedder);
    const result = await runIngestion(
      deps,
      built,
      chunks,
      caps({ maxChunks: 2 }),
    );
    expect(result).toEqual({
      ok: false,
      reason: 'cap_exceeded',
      embedCalls: 0,
    });
    expect(embedder.calls()).toBe(0);
    expect(admin.indexes.size).toBe(0);
  });

  test('refuses to build into the active index unless it is already complete', async () => {
    const { admin, deps } = setup({
      activeIndex: () => Promise.resolve(built.indexName),
    });
    expect(await runIngestion(deps, built, chunks)).toMatchObject({
      ok: false,
      reason: 'active_not_complete',
    });
    expect(admin.indexes.size).toBe(0);
  });

  test('refuses an existing index whose manifest hash differs', async () => {
    const { admin, deps } = setup();
    await admin.create(built.indexName, 'f'.repeat(64));
    expect(await runIngestion(deps, built, chunks)).toMatchObject({
      ok: false,
      reason: 'manifest_mismatch',
    });
  });

  test('a failed active-index read is a refusal, not a guess', async () => {
    const { deps } = setup({
      activeIndex: () => Promise.reject(new Error('x')),
    });
    expect(await runIngestion(deps, built, chunks)).toMatchObject({
      ok: false,
      reason: 'admin_failed',
    });
  });

  describe('embedding bounds', () => {
    // Fails the first `failures` calls with a code, then behaves like the fake.
    function flaky(failures: number, code: 'throttled' | 'invalid_request') {
      const inner = new FakeEmbedder();
      let calls = 0;
      const starts: number[] = [];
      return {
        embedder: {
          config: EMBEDDING_CONFIG,
          embed: (text: string): Promise<EmbedResult> => {
            calls++;
            starts.push(Date.now());
            return calls <= failures
              ? Promise.resolve({ ok: false, code })
              : inner.embed(text);
          },
        } satisfies Embedder,
        calls: () => calls,
      };
    }

    test('retries a throttled call once and then succeeds', async () => {
      const f = flaky(1, 'throttled');
      const { deps } = setup({}, f.embedder);
      const result = await runIngestion(
        deps,
        built,
        chunks,
        caps({ concurrency: 1 }),
      );
      expect(result).toMatchObject({ ok: true });
      expect(f.calls()).toBe(chunks.length + 1);
    });

    test('gives up after one retry per chunk and does not complete the index', async () => {
      const f = flaky(Number.MAX_SAFE_INTEGER, 'throttled');
      const { admin, deps } = setup({}, f.embedder);
      const result = await runIngestion(
        deps,
        built,
        chunks,
        caps({ concurrency: 1 }),
      );
      expect(result).toEqual({
        ok: false,
        reason: 'embed_failed',
        embedCalls: 2,
      });
      expect(f.calls()).toBe(2);
      expect(admin.indexes.get(built.indexName)?.complete).toBe(false);
    });

    test('does not retry a request the model rejected', async () => {
      const f = flaky(Number.MAX_SAFE_INTEGER, 'invalid_request');
      const { deps } = setup({}, f.embedder);
      const result = await runIngestion(
        deps,
        built,
        chunks,
        caps({ concurrency: 1 }),
      );
      expect(result).toMatchObject({
        ok: false,
        reason: 'embed_failed',
        embedCalls: 1,
      });
    });

    test('never exceeds the request rate', async () => {
      vi.useFakeTimers();
      try {
        const inner = new FakeEmbedder();
        const starts: number[] = [];
        const embedder: Embedder = {
          config: EMBEDDING_CONFIG,
          embed: (text) => {
            starts.push(Date.now());
            return inner.embed(text);
          },
        };
        // Real (here: faked) timers and clock, so pacing and sleeping advance together.
        const { deps } = setup(
          {
            now: Date.now,
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          },
          embedder,
        );
        const run = runIngestion(
          deps,
          built,
          chunks,
          caps({ maxRps: 5, concurrency: 4 }),
        );
        await vi.advanceTimersByTimeAsync(60_000);
        expect(await run).toMatchObject({ ok: true });
        expect(starts.length).toBe(chunks.length);
        for (let i = 1; i < starts.length; i++) {
          expect(
            (starts[i] ?? 0) - (starts[i - 1] ?? 0),
          ).toBeGreaterThanOrEqual(200);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    test('stops promptly when cancelled and completes nothing', async () => {
      const controller = new AbortController();
      const inner = new FakeEmbedder();
      const embedder: Embedder = {
        config: EMBEDDING_CONFIG,
        embed: (text) => {
          controller.abort();
          return inner.embed(text);
        },
      };
      const { admin, deps } = setup({}, embedder);
      const result = await runIngestion(
        deps,
        built,
        chunks,
        caps({ concurrency: 1 }),
        controller.signal,
      );
      expect(result).toMatchObject({ ok: false, reason: 'cancelled' });
      expect(admin.indexes.get(built.indexName)?.complete).toBe(false);
    });
  });

  describe('verification', () => {
    test('fails, and does not complete, when the index holds an unexpected key', async () => {
      const { admin, deps } = setup();
      const listKeys = admin.listKeys.bind(admin);
      admin.listKeys = async (index) => [
        ...(await listKeys(index)),
        'extra-doc#x-1',
      ];
      const result = await runIngestion(deps, built, chunks);
      expect(result).toMatchObject({ ok: false, reason: 'verify_failed' });
      expect(admin.indexes.get(built.indexName)?.complete).toBe(false);
    });

    test('fails when a key is missing after the writes', async () => {
      const { admin, deps } = setup();
      const listKeys = admin.listKeys.bind(admin);
      admin.listKeys = async (index) => (await listKeys(index)).slice(1);
      expect(await runIngestion(deps, built, chunks)).toMatchObject({
        ok: false,
        reason: 'verify_failed',
      });
    });

    test('retries the self-query until the data is searchable', async () => {
      const { admin, deps, clock: c } = setup();
      admin.queriesBeforeVisible = 2;
      const result = await runIngestion(deps, built, chunks);
      expect(result).toMatchObject({ ok: true });
      expect(admin.calls.query).toBe(3);
      expect(
        c.sleeps.filter((ms) => ms === INGEST_CAPS.verifyDelayMs),
      ).toHaveLength(2);
    });

    test('fails, and does not complete, when the data never becomes searchable', async () => {
      const { admin, deps } = setup();
      admin.queriesBeforeVisible = 1000;
      const result = await runIngestion(
        deps,
        built,
        chunks,
        caps({ verifyAttempts: 3 }),
      );
      expect(result).toMatchObject({ ok: false, reason: 'verify_failed' });
      expect(admin.calls.query).toBe(3);
      expect(admin.indexes.get(built.indexName)?.complete).toBe(false);
    });
  });
});

describe('isAssumedRole', () => {
  const arn = (role: string) =>
    `arn:aws:sts::123456789012:assumed-role/${role}/session-1`;

  test('accepts only the named role', () => {
    expect(
      isAssumedRole(
        arn('portfolio-v2-prod-ingest'),
        'portfolio-v2-prod-ingest',
      ),
    ).toBe(true);
    for (const other of [
      arn('portfolio-v2-prod-operator'),
      arn('portfolio-v2-prod-ingest-extra'),
      arn('portfolio-v2-prod-eval'),
      'arn:aws:iam::123456789012:user/portfolio-v2-prod-ingest',
      'arn:aws:sts::123456789012:assumed-role/portfolio-v2-prod-ingest/',
      '',
    ]) {
      expect(isAssumedRole(other, 'portfolio-v2-prod-ingest')).toBe(false);
    }
  });
});
