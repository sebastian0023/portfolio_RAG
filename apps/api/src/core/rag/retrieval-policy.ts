import { MAX_SOURCES } from '@portfolio/shared';
import type { Limits } from '../config/runtime-config.js';

// A code constant on purpose, not a `limits` key: `limitsSchema` is strict, so a key that older Lambda versions
// do not know would make the config invalid after a rollback (ADR-054). Provisional until the real corpus exists;
// changing it requires a new eval gate run before promotion.
export const RETRIEVAL_POLICY = {
  version: 1,
  // Cosine similarity below this is not evidence.
  minScore: 0.25,
  filter: { lang: 'en' },
} as const;

// The browser rejects more than MAX_SOURCES sources, so the limit can lower the count but never raise it.
export const topKFor = (limits: Pick<Limits, 'retrievedChunks'>): number =>
  Math.min(limits.retrievedChunks, MAX_SOURCES);
