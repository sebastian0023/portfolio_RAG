import { createHash } from 'node:crypto';
import type { Embedder, EmbedResult } from '@portfolio/shared';
import { EMBEDDING_CONFIG } from '@portfolio/shared';

const MAX_INPUT_CHARS = 4000;

// A hashed bag of words folded into a unit vector: texts that share words are close, unrelated texts are not.
// Deterministic and free, so retrieval tests need no model. It counts its calls like a paid backend would.
// The vector the fake assigns to a text, or undefined when it has no usable words. Exported so a test can seed an
// index with the same vectors the embedder will later produce for a question.
export function fakeVectorFor(text: string): number[] | undefined {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (words.length === 0) return undefined;
  const vector = new Array<number>(EMBEDDING_CONFIG.dimensions).fill(0);
  for (const word of words) {
    const digest = createHash('sha256').update(word).digest();
    const slot = digest.readUInt16BE(0) % EMBEDDING_CONFIG.dimensions;
    vector[slot] = (vector[slot] ?? 0) + (digest[2]! % 2 === 0 ? 1 : -1);
  }
  const norm = Math.hypot(...vector);
  return norm === 0 ? undefined : vector.map((x) => x / norm);
}

export class FakeEmbedder implements Embedder {
  readonly config = EMBEDDING_CONFIG;
  #calls = 0;

  calls(): number {
    return this.#calls;
  }

  embed(text: string, signal?: AbortSignal): Promise<EmbedResult> {
    return Promise.resolve(this.#embed(text, signal));
  }

  #embed(text: string, signal?: AbortSignal): EmbedResult {
    if (signal?.aborted) return { ok: false, code: 'cancelled' };
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    if (words.length === 0 || text.length > MAX_INPUT_CHARS) {
      return { ok: false, code: 'invalid_request' };
    }
    const vector = fakeVectorFor(text);
    if (vector === undefined) return { ok: false, code: 'invalid_request' };
    this.#calls++;
    return { ok: true, vector, inputTokens: words.length };
  }
}
