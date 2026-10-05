import type { Embedder, IndexRepository } from '@portfolio/shared';
import type { Chunk } from './chunker.js';
import type { BuiltManifest } from './manifest.js';
import { embeddingInput, toVectorMetadata } from './metadata.js';
import type { VectorMetadata } from './metadata.js';

// Builds a candidate index from a reviewed corpus (ADR-053). Everything here is bounded and resumable, and the
// only way it can finish is to tag the index complete after checking what is actually in it. It never reads or
// writes `active_index` except to refuse to touch it.

export interface IngestCaps {
  readonly maxChunks: number;
  readonly maxEstimatedTokens: number;
  readonly concurrency: number;
  // Half the Titan quota of 600 requests per minute (model-probe.md).
  readonly maxRps: number;
  readonly putBatch: number;
  // Per embedding call. Abuse budget: 1 retry for embedding (abuse-budgets.md).
  readonly retries: number;
  readonly verifyAttempts: number;
  readonly verifyDelayMs: number;
}

export const INGEST_CAPS: IngestCaps = {
  maxChunks: 2000,
  maxEstimatedTokens: 400_000,
  concurrency: 4,
  maxRps: 5,
  putBatch: 100,
  retries: 1,
  verifyAttempts: 6,
  verifyDelayMs: 5000,
};

export interface VectorRecord {
  readonly key: string;
  readonly vector: readonly number[];
  readonly metadata: VectorMetadata;
}

export interface IndexInfo {
  readonly complete: boolean;
  readonly manifestSha256: string | undefined;
}

// The index operations ingestion needs. Methods throw on failure; the run turns that into `admin_failed` without
// repeating any detail.
export interface IndexAdmin {
  describe(index: string, signal?: AbortSignal): Promise<IndexInfo | undefined>;
  create(
    index: string,
    manifestSha256: string,
    signal?: AbortSignal,
  ): Promise<void>;
  put(
    index: string,
    vectors: readonly VectorRecord[],
    signal?: AbortSignal,
  ): Promise<void>;
  listKeys(index: string, signal?: AbortSignal): Promise<readonly string[]>;
  markComplete(index: string, signal?: AbortSignal): Promise<void>;
}

export interface IngestDeps {
  readonly admin: IndexAdmin;
  readonly embedder: Embedder;
  readonly repository: IndexRepository;
  readonly activeIndex: () => Promise<string>;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

export type IngestFailure =
  | 'cap_exceeded'
  | 'active_not_complete'
  | 'manifest_mismatch'
  | 'admin_failed'
  | 'embed_failed'
  | 'call_cap'
  | 'verify_failed'
  | 'cancelled';

export type IngestResult =
  | {
      readonly ok: true;
      readonly action: 'noop' | 'created' | 'resumed';
      readonly indexName: string;
      readonly chunks: number;
      readonly embedCalls: number;
    }
  | {
      readonly ok: false;
      readonly reason: IngestFailure;
      readonly embedCalls: number;
    };

const encoder = new TextEncoder();
// Titan's real count is lower for English prose, so this over-estimates on purpose.
export const estimateTokens = (text: string): number =>
  Math.ceil(encoder.encode(text).length / 3);

export interface IngestPlan {
  readonly indexName: string;
  readonly manifestSha256: string;
  readonly chunks: number;
  readonly estimatedTokens: number;
  // Titan v2 reference price: $0.02 per 1M input tokens (abuse-budgets.md). Provisional until billed.
  readonly estimatedCostUsd: number;
  readonly withinCaps: boolean;
}

export function planIngestion(
  built: BuiltManifest,
  chunks: readonly Chunk[],
  caps: IngestCaps = INGEST_CAPS,
): IngestPlan {
  const estimatedTokens = chunks.reduce(
    (sum, chunk) => sum + estimateTokens(embeddingInput(chunk)),
    0,
  );
  return {
    indexName: built.indexName,
    manifestSha256: built.manifestSha256,
    chunks: chunks.length,
    estimatedTokens,
    estimatedCostUsd: (estimatedTokens / 1_000_000) * 0.02,
    withinCaps:
      chunks.length <= caps.maxChunks &&
      estimatedTokens <= caps.maxEstimatedTokens,
  };
}

// Spaces call starts at least 1/maxRps apart. `next` is updated before the await, so concurrent workers queue up
// instead of bursting.
function createPacer(
  maxRps: number,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): () => Promise<void> {
  const interval = 1000 / maxRps;
  let next = 0;
  return async () => {
    const current = now();
    const start = Math.max(current, next);
    next = start + interval;
    if (start > current) await sleep(start - current);
  };
}

export async function runIngestion(
  deps: IngestDeps,
  built: BuiltManifest,
  chunks: readonly Chunk[],
  caps: IngestCaps = INGEST_CAPS,
  signal?: AbortSignal,
): Promise<IngestResult> {
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const index = built.indexName;
  let embedCalls = 0;
  const fail = (reason: IngestFailure): IngestResult => ({
    ok: false,
    reason,
    embedCalls,
  });
  const cancelled = (): boolean => signal?.aborted === true;

  // 1. Caps come first: nothing is called for a corpus that is over budget.
  if (!planIngestion(built, chunks, caps).withinCaps) {
    return fail('cap_exceeded');
  }

  let info: Awaited<ReturnType<IndexAdmin['describe']>>;
  let active: string;
  try {
    // 2. Never build into the live index, and a complete index with this hash needs no work.
    active = await deps.activeIndex();
    info = await deps.admin.describe(index, signal);
  } catch {
    return fail('admin_failed');
  }
  if (info?.complete === true && info.manifestSha256 === built.manifestSha256) {
    return {
      ok: true,
      action: 'noop',
      indexName: index,
      chunks: chunks.length,
      embedCalls,
    };
  }
  if (index === active) return fail('active_not_complete');
  if (info !== undefined && info.manifestSha256 !== built.manifestSha256) {
    return fail('manifest_mismatch');
  }

  // 3. Create the index, or resume a pending one by skipping the keys it already holds.
  let present = new Set<string>();
  try {
    if (info === undefined) {
      await deps.admin.create(index, built.manifestSha256, signal);
    } else {
      present = new Set(await deps.admin.listKeys(index, signal));
    }
  } catch {
    return fail('admin_failed');
  }
  const action = info === undefined ? 'created' : 'resumed';
  const todo = chunks.filter((chunk) => !present.has(chunk.chunkId));

  // 4. Embed with bounded concurrency, a rate cap, one retry per call, and a ceiling on total calls.
  const callCap = 2 * chunks.length + 1;
  const pace = createPacer(caps.maxRps, now, sleep);
  const vectors = new Map<string, readonly number[]>();
  let failure: IngestFailure | undefined;

  const embedOne = async (chunk: Chunk): Promise<IngestFailure | undefined> => {
    for (let attempt = 0; attempt <= caps.retries; attempt++) {
      if (cancelled()) return 'cancelled';
      if (embedCalls >= callCap) return 'call_cap';
      await pace();
      embedCalls++;
      const result = await deps.embedder.embed(embeddingInput(chunk), signal);
      if (result.ok) {
        vectors.set(chunk.chunkId, result.vector);
        return undefined;
      }
      if (result.code === 'cancelled') return 'cancelled';
      const retryable =
        result.code === 'throttled' || result.code === 'unavailable';
      if (!retryable || attempt === caps.retries) return 'embed_failed';
      await sleep(500 + random() * 500);
    }
    return 'embed_failed';
  };

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (failure === undefined) {
      const chunk = todo[cursor++];
      if (chunk === undefined) return;
      failure = await embedOne(chunk);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(caps.concurrency, todo.length) }, worker),
  );
  if (failure !== undefined) return fail(failure);

  // 5. Write in batches. A failure here leaves a pending index that nothing reads and a re-run finishes.
  try {
    for (let i = 0; i < todo.length; i += caps.putBatch) {
      if (cancelled()) return fail('cancelled');
      const batch = todo
        .slice(i, i + caps.putBatch)
        .map((chunk): VectorRecord => ({
          key: chunk.chunkId,
          vector: vectors.get(chunk.chunkId) ?? [],
          metadata: toVectorMetadata(chunk),
        }));
      await deps.admin.put(index, batch, signal);
    }
  } catch {
    return fail('admin_failed');
  }

  // 6. Verify what is really in the index, not what we meant to write.
  try {
    const keys = new Set(await deps.admin.listKeys(index, signal));
    const expected = new Set(chunks.map((c) => c.chunkId));
    if (
      keys.size !== expected.size ||
      [...expected].some((key) => !keys.has(key))
    ) {
      return fail('verify_failed');
    }
  } catch {
    return fail('admin_failed');
  }

  // A just-written vector may take a moment to be searchable (not documented), so the self-query retries.
  const probe = chunks[0];
  if (probe !== undefined) {
    let vector = vectors.get(probe.chunkId);
    if (vector === undefined) {
      const again = await deps.embedder.embed(embeddingInput(probe), signal);
      embedCalls++;
      if (!again.ok) return fail('embed_failed');
      vector = again.vector;
    }
    let found = false;
    for (let attempt = 0; attempt < caps.verifyAttempts && !found; attempt++) {
      if (cancelled()) return fail('cancelled');
      if (attempt > 0) await sleep(caps.verifyDelayMs);
      const result = await deps.repository.query(
        { index, vector, topK: 3, filter: { lang: 'en' } },
        signal,
      );
      found =
        result.ok && result.matches.some((m) => m.chunkId === probe.chunkId);
    }
    if (!found) return fail('verify_failed');
  }

  // 7. Only now does the index become eligible for promotion.
  try {
    await deps.admin.markComplete(index, signal);
  } catch {
    return fail('admin_failed');
  }
  return {
    ok: true,
    action,
    indexName: index,
    chunks: chunks.length,
    embedCalls,
  };
}
