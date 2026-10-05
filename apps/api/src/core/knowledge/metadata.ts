import type { Chunk } from './chunker.js';
import {
  MAX_FILTERABLE_BYTES,
  MAX_METADATA_BYTES,
  METADATA_SCHEMA_VERSION,
  NON_FILTERABLE_KEYS,
} from './config.js';

export type VectorMetadata = Readonly<Record<string, string | number>>;

const encoder = new TextEncoder();
const bytes = (value: string | number): number =>
  encoder.encode(String(value)).length;

// Filterable: sourceId, kind, lang, updated, schema. Everything in NON_FILTERABLE_KEYS is declared as such on the
// index, which is how 600 characters of text fits next to a 2 KB filterable limit (R-02).
export function toVectorMetadata(chunk: Chunk): VectorMetadata {
  return {
    sourceId: chunk.sourceId,
    kind: chunk.kind,
    lang: chunk.lang,
    updated: chunk.updated,
    schema: METADATA_SCHEMA_VERSION,
    text: chunk.text,
    title: chunk.title,
    section: chunk.section,
    path: chunk.path,
    ...(chunk.url === undefined ? {} : { url: chunk.url }),
    contentHash: chunk.contentHash,
  };
}

// Returns the rules a metadata record breaks, measured in UTF-8 bytes, not characters.
export function checkMetadataLimits(metadata: VectorMetadata): string[] {
  const nonFilterable = new Set<string>(NON_FILTERABLE_KEYS);
  let filterable = 0;
  let total = 0;
  for (const [key, value] of Object.entries(metadata)) {
    const size = bytes(key) + bytes(value);
    total += size;
    if (!nonFilterable.has(key)) filterable += size;
  }
  const rules: string[] = [];
  if (filterable > MAX_FILTERABLE_BYTES) rules.push('metadata_filterable_size');
  if (total > MAX_METADATA_BYTES) rules.push('metadata_total_size');
  return rules;
}

// What gets embedded. The title and section give a short chunk the context its text leaves out.
export function embeddingInput(chunk: Chunk): string {
  return `${chunk.title}\n${chunk.section}\n${chunk.text}`;
}
