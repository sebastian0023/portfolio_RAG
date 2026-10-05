import { EMBEDDING_CONFIG } from '@portfolio/shared';

// Everything here feeds the manifest hash (ADR-053): changing any value produces a new index name.

export const CHUNKER_CONFIG = {
  version: 1,
  maxChars: 600,
  minChars: 120,
} as const;

export const METADATA_SCHEMA_VERSION = 1;

// The index keeps these keys out of the filterable set. Everything else in a vector's metadata is filterable.
export const NON_FILTERABLE_KEYS = [
  'text',
  'title',
  'section',
  'path',
  'url',
  'contentHash',
] as const;

export const INDEX_CONFIG = {
  dimension: EMBEDDING_CONFIG.dimensions,
  distanceMetric: 'cosine',
  dataType: EMBEDDING_CONFIG.dataType,
  nonFilterableMetadataKeys: NON_FILTERABLE_KEYS,
} as const;

// S3 Vectors index names are at most 63 characters; `chunks-` plus 16 hex is well inside that.
export const INDEX_NAME_PATTERN = /^chunks-[0-9a-f]{16}$/;
export const CHUNK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}#[a-z0-9-]+-[0-9]+$/;
export const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

// Our own limits, with headroom under the service limits (2048 bytes filterable, 40 KB total; R-02).
export const MAX_FILTERABLE_BYTES = 1024;
export const MAX_METADATA_BYTES = 16 * 1024;

export const CONFIGS = {
  chunker: CHUNKER_CONFIG,
  embedding: EMBEDDING_CONFIG,
  index: INDEX_CONFIG,
  metadataSchema: METADATA_SCHEMA_VERSION,
} as const;

export type Configs = {
  readonly chunker: unknown;
  readonly embedding: unknown;
  readonly index: unknown;
  readonly metadataSchema: unknown;
  // Folded into the hash only when set. The rollback drill uses it to build a second, different index.
  readonly salt?: string;
};

// A finding names the rule and the line, never the offending text, so a report cannot leak what it found.
export interface Finding {
  readonly path: string;
  readonly rule: string;
  readonly line: number;
}
