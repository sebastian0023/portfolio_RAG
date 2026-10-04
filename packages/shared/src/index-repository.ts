export interface IndexQuery {
  readonly vector: readonly number[];
  readonly limit: number;
  readonly filters?: Readonly<Record<string, string>>;
}

export interface IndexMatch {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly score: number;
  readonly text: string;
  readonly sourceUrl?: string;
}

// References a retrieved chunk without exposing its text. The browser also receives a bounded public
// excerpt through SourceCitation in chat-stream.ts (ADR-048); this type stays text-free.
export interface Citation {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly sourceUrl?: string;
}

export interface IndexRepository {
  query(
    request: IndexQuery,
    signal?: AbortSignal,
  ): Promise<readonly IndexMatch[]>;
}
