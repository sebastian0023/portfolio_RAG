import { SOURCE_KINDS, isAllowedSourceUrl } from '@portfolio/shared';
import { z } from 'zod';
import {
  CHUNK_ID_PATTERN,
  METADATA_SCHEMA_VERSION,
} from '../../core/knowledge/config.js';

// Trust-boundary validation of what the vector store returns (ADR-044). Metadata is whatever was written at
// ingestion, so a record that does not match is dropped rather than shown to a visitor or put in a prompt.
export function metadataSchema(allowedHosts: readonly string[]) {
  return z.strictObject({
    sourceId: z.string().min(1),
    kind: z.enum(SOURCE_KINDS),
    lang: z.literal('en'),
    updated: z.string().min(1),
    schema: z.literal(METADATA_SCHEMA_VERSION),
    text: z.string().min(1).max(600),
    title: z.string().min(1).max(120),
    section: z.string().min(1).max(120),
    path: z.string().min(1).max(200),
    url: z
      .string()
      .refine((value) => isAllowedSourceUrl(value, allowedHosts))
      .exactOptional(),
    contentHash: z.string().length(64),
  });
}

export const queryOutputSchema = z.object({
  distanceMetric: z.literal('cosine'),
  vectors: z.array(
    z.object({
      key: z.string().regex(CHUNK_ID_PATTERN),
      distance: z.number().finite(),
      metadata: z.unknown(),
    }),
  ),
});
