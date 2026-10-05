import type { SourceKind } from './knowledge.js';

// References a retrieved chunk without exposing its text. The browser also receives a bounded public
// excerpt through SourceCitation in chat-stream.ts (ADR-048); this type stays text-free.
export interface Citation {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly sourceUrl?: string;
}

// Typed filters, not a free-form map: the adapter turns them into the service's filter syntax, so a caller can
// never inject an arbitrary filter expression (ADR-038).
export interface IndexFilter {
  readonly lang?: 'en';
  readonly kinds?: readonly SourceKind[];
}

export interface IndexQuery {
  // The index to read, `chunks-<16 hex>`. Blue/green promotion changes it per request (ADR-019).
  readonly index: string;
  readonly vector: readonly number[];
  readonly topK: number;
  readonly filter?: IndexFilter;
}

// A retrieved chunk with everything the API needs to build a prompt and a source card (ADR-048). `score` is
// cosine similarity (1 is identical, 0 is orthogonal) and is the same on every adapter.
export interface IndexMatch extends Citation {
  readonly score: number;
  readonly text: string;
  readonly title: string;
  readonly section: string;
  readonly path: string;
  readonly updated: string;
  readonly kind: SourceKind;
}

export type IndexErrorCode =
  | 'not_found'
  | 'invalid_request'
  | 'throttled'
  | 'unavailable'
  | 'cancelled'
  | 'internal';

export type IndexQueryResult =
  | {
      readonly ok: true;
      // Ordered by score descending, then chunkId ascending.
      readonly matches: readonly IndexMatch[];
      // Results the backend returned that failed validation and were left out.
      readonly dropped: number;
    }
  | { readonly ok: false; readonly code: IndexErrorCode };

export interface IndexRepository {
  query(request: IndexQuery, signal?: AbortSignal): Promise<IndexQueryResult>;
}
