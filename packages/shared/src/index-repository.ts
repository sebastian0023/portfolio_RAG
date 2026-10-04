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

// Returned to the browser; references a retrieved chunk without exposing its text.
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
