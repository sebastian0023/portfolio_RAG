import {
  InvokeModelCommand,
  type InvokeModelCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type { EmbedErrorCode, Embedder, EmbedResult } from '@portfolio/shared';
import { EMBEDDING_CONFIG } from '@portfolio/shared';
import { z } from 'zod';
import { mapSdkError } from './error-map.js';

export interface BedrockInvokeClientLike {
  send(
    command: InvokeModelCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<InvokeModelCommandOutput>;
}

// Questions are at most 500 characters and chunks about 700 with their title, so this cap is far above real use
// and far below the model's own limit. It bounds what a single call can cost.
const MAX_INPUT_CHARS = 4000;

const responseSchema = z.object({
  embedding: z.array(z.number().finite()).length(EMBEDDING_CONFIG.dimensions),
  inputTextTokenCount: z.number().int().min(0),
});

const CODES: Readonly<Record<string, EmbedErrorCode>> = {
  throttled: 'throttled',
  unavailable: 'unavailable',
  invalid_request: 'invalid_request',
  cancelled: 'cancelled',
};

export class TitanEmbedder implements Embedder {
  readonly config = EMBEDDING_CONFIG;
  readonly #client: BedrockInvokeClientLike;

  constructor(client: BedrockInvokeClientLike) {
    this.#client = client;
  }

  async embed(text: string, signal?: AbortSignal): Promise<EmbedResult> {
    if (signal?.aborted) return { ok: false, code: 'cancelled' };
    if (text.trim() === '' || text.length > MAX_INPUT_CHARS) {
      return { ok: false, code: 'invalid_request' };
    }
    let output: InvokeModelCommandOutput;
    try {
      output = await this.#client.send(
        new InvokeModelCommand({
          modelId: EMBEDDING_CONFIG.model,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            inputText: text,
            dimensions: EMBEDDING_CONFIG.dimensions,
            normalize: EMBEDDING_CONFIG.normalize,
          }),
        }),
        signal === undefined ? undefined : { abortSignal: signal },
      );
    } catch (error) {
      return {
        ok: false,
        code: CODES[mapSdkError(error, signal).code] ?? 'internal',
      };
    }

    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(output.body));
    } catch {
      return { ok: false, code: 'internal' };
    }
    const parsed = responseSchema.safeParse(json);
    // A zero vector is meaningless under cosine and the index rejects it, so it is a failure here.
    if (!parsed.success || !parsed.data.embedding.some((x) => x !== 0)) {
      return { ok: false, code: 'internal' };
    }
    return {
      ok: true,
      vector: parsed.data.embedding,
      inputTokens: parsed.data.inputTextTokenCount,
    };
  }
}
