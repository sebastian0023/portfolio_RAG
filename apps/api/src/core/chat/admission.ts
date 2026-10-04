import {
  MAX_QUESTION_LENGTH,
  MAX_REQUEST_BYTES,
  type LLMProvider,
  type QuotaState,
} from '@portfolio/shared';
import type { ProviderRegistry } from '../llm/provider-registry.js';
import type { CachedConfig } from '../config/cached-config.js';
import type { RuntimeConfig } from '../config/runtime-config.js';
import {
  serverChatRequestSchema,
  type ParsedChatRequest,
} from './chat-request.js';
import { reject, type Rejection } from './rejection.js';

// Chain of Responsibility (ADR-039). Stages run in an explicit, cheapest-first order (ADR-016); the first
// rejection ends the chain, so no later stage and no paid call runs for a refused request.
export interface AdmissionContext {
  readonly contentType: string | null;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
  readonly signal: AbortSignal;
  // Filled in by earlier stages for later ones.
  bodyBytes?: Uint8Array;
  request?: ParsedChatRequest;
  config?: RuntimeConfig;
  provider?: LLMProvider;
  quota?: QuotaState;
  // Bucket key of the viewer (IPv4 address or IPv6 /64) from the trusted edge header.
  clientKey?: string;
}

export type AdmissionStage = (
  ctx: AdmissionContext,
) => Promise<Rejection | undefined>;

export async function runAdmission(
  stages: readonly AdmissionStage[],
  ctx: AdmissionContext,
): Promise<Rejection | undefined> {
  for (const stage of stages) {
    const rejection = await stage(ctx);
    if (rejection) return rejection;
  }
  return undefined;
}

export const contentTypeStage: AdmissionStage = (ctx) => {
  const type = ctx.contentType?.split(';')[0]?.trim().toLowerCase();
  return Promise.resolve(
    type === 'application/json'
      ? undefined
      : reject('unavailable', { status: 415 }),
  );
};

// Reads at most MAX_REQUEST_BYTES + 1 bytes, so an oversized body is refused without buffering it.
export const byteCapStage: AdmissionStage = async (ctx) => {
  if (ctx.body === null) return reject('unavailable', { status: 400 });
  const reader = ctx.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return reject('too_long', { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return reject('unavailable', { status: 400 });
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  ctx.bodyBytes = bytes;
  return undefined;
};

export const schemaStage: AdmissionStage = (ctx) => {
  let json: unknown;
  try {
    json = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(ctx.bodyBytes),
    );
  } catch {
    return Promise.resolve(reject('unavailable', { status: 400 }));
  }
  const parsed = serverChatRequestSchema.safeParse(json);
  if (!parsed.success) {
    return Promise.resolve(reject('unavailable', { status: 400 }));
  }
  const question = parsed.data.question.trim();
  if (question.length === 0) {
    return Promise.resolve(reject('unavailable', { status: 400 }));
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return Promise.resolve(reject('too_long'));
  }
  ctx.request = { ...parsed.data, question };
  return Promise.resolve(undefined);
};

// Loads validated config and re-checks the request against the operator-set limits. Missing, invalid, or
// stale config rejects (ADR-027): there is no default to fall back to.
export function configStage(config: CachedConfig): AdmissionStage {
  return async (ctx) => {
    const state = await config.get();
    if (state.status !== 'ready') return reject('unavailable');
    const { limits } = state.config;
    if ((ctx.bodyBytes?.byteLength ?? 0) > limits.requestMaxBytes) {
      return reject('too_long', { status: 413 });
    }
    if ((ctx.request?.question.length ?? 0) > limits.questionMaxChars) {
      return reject('too_long');
    }
    ctx.config = state.config;
    return undefined;
  };
}

// Resolves the configured model to an adapter. A pair with no adapter is refused here, before anything is
// reserved or spent.
export function providerStage(registry: ProviderRegistry): AdmissionStage {
  return (ctx) => {
    const provider = ctx.config ? registry.resolve(ctx.config.llm) : null;
    if (!provider) return Promise.resolve(reject('unavailable'));
    ctx.provider = provider;
    return Promise.resolve(undefined);
  };
}
