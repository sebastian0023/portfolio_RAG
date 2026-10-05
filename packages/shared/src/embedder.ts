// The embedding model and its settings are one coherent value (ADR-020). Ingestion and queries must use the
// same one, and it is part of the manifest hash, so changing it produces a new index.
export const EMBEDDING_CONFIG = {
  model: 'amazon.titan-embed-text-v2:0',
  dimensions: 512,
  normalize: true,
  dataType: 'float32',
} as const;

export type EmbedErrorCode =
  'throttled' | 'unavailable' | 'invalid_request' | 'cancelled' | 'internal';

export type EmbedResult =
  | {
      readonly ok: true;
      readonly vector: readonly number[];
      readonly inputTokens: number;
    }
  | { readonly ok: false; readonly code: EmbedErrorCode };

export interface Embedder {
  readonly config: typeof EMBEDDING_CONFIG;
  embed(text: string, signal?: AbortSignal): Promise<EmbedResult>;
}
