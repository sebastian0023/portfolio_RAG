import { createHash } from 'node:crypto';
import type { Embedder, EmbedResult } from '@portfolio/shared';
import { EMBEDDING_CONFIG } from '@portfolio/shared';

const MAX_INPUT_CHARS = 4000;

// A hashed bag of words folded into a unit vector: texts that share words are close, unrelated texts are not.
// Deterministic and free, so retrieval tests need no model. It counts its calls like a paid backend would.
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
    this.#calls++;
    const vector = new Array<number>(EMBEDDING_CONFIG.dimensions).fill(0);
    for (const word of words) {
      const digest = createHash('sha256').update(word).digest();
      const slot = digest.readUInt16BE(0) % EMBEDDING_CONFIG.dimensions;
      vector[slot] = (vector[slot] ?? 0) + (digest[2]! % 2 === 0 ? 1 : -1);
    }
    const norm = Math.hypot(...vector);
    if (norm === 0) return { ok: false, code: 'invalid_request' };
    return {
      ok: true,
      vector: vector.map((x) => x / norm),
      inputTokens: words.length,
    };
  }
}
