import type {
  IndexFilter,
  IndexMatch,
  IndexQuery,
  IndexQueryResult,
  IndexRepository,
} from '@portfolio/shared';
import { EMBEDDING_CONFIG } from '@portfolio/shared';
import { cosine, isUsableVector } from './vector-math.js';

export interface SeedRecord extends Omit<IndexMatch, 'score' | 'sourceUrl'> {
  readonly lang: 'en';
  readonly sourceUrl?: string;
  readonly vector: readonly number[];
}

// Exact cosine search over seeded records. It runs the same IndexRepository contract suite as the S3 Vectors
// adapter (ADR-045), but a fake proves nothing about service limits or latency (ADR-038).
export class InMemoryIndexRepository implements IndexRepository {
  readonly #indexes = new Map<string, readonly SeedRecord[]>();
  #calls = 0;

  addIndex(name: string, records: readonly SeedRecord[]): this {
    this.#indexes.set(name, records);
    return this;
  }

  calls(): number {
    return this.#calls;
  }

  query(request: IndexQuery, signal?: AbortSignal): Promise<IndexQueryResult> {
    if (signal?.aborted)
      return Promise.resolve({ ok: false, code: 'cancelled' });
    if (
      !isUsableVector(request.vector, EMBEDDING_CONFIG.dimensions) ||
      !Number.isInteger(request.topK) ||
      request.topK < 1 ||
      request.topK > 20
    ) {
      return Promise.resolve({ ok: false, code: 'invalid_request' });
    }
    this.#calls++;
    const records = this.#indexes.get(request.index);
    if (records === undefined) {
      return Promise.resolve({ ok: false, code: 'not_found' });
    }
    const matches = records
      .filter((record) => matchesFilter(record, request.filter))
      .map((record): IndexMatch => ({
        chunkId: record.chunkId,
        sourceId: record.sourceId,
        ...(record.sourceUrl === undefined
          ? {}
          : { sourceUrl: record.sourceUrl }),
        score: cosine(request.vector, record.vector),
        text: record.text,
        title: record.title,
        section: record.section,
        path: record.path,
        updated: record.updated,
        kind: record.kind,
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0),
      )
      .slice(0, request.topK);
    return Promise.resolve({ ok: true, matches, dropped: 0 });
  }
}

export function matchesFilter(
  record: { readonly lang: string; readonly kind: string },
  filter: IndexFilter | undefined,
): boolean {
  if (filter?.lang !== undefined && record.lang !== filter.lang) return false;
  if (
    filter?.kinds !== undefined &&
    !filter.kinds.some((kind) => kind === record.kind)
  ) {
    return false;
  }
  return true;
}
