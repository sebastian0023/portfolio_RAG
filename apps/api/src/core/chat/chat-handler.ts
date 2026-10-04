import type { ChatStreamEvent } from '@portfolio/shared';
import type { RuntimeConfig } from '../config/runtime-config.js';
import type { Logger } from '../ports/logger.js';
import {
  runAdmission,
  type AdmissionContext,
  type AdmissionStage,
} from './admission.js';
import type { ParsedChatRequest } from './chat-request.js';
import { statusForCode } from './rejection.js';

export interface ChatServiceInput {
  readonly request: ParsedChatRequest;
  readonly config: RuntimeConfig;
  readonly signal: AbortSignal;
}

// Produces the answer stream for an admitted request. A first event of `error` means the request failed
// before the answer began; the handler turns that into a non-2xx status (ADR-049).
export interface ChatService {
  stream(input: ChatServiceInput): AsyncIterable<ChatStreamEvent>;
}

export interface ChatResponse {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  readonly events: AsyncIterable<ChatStreamEvent>;
}

export type ChatHandler = (
  ctx: AdmissionContext,
  requestId: string,
) => Promise<ChatResponse>;

export interface ChatHandlerDeps {
  readonly stages: readonly AdmissionStage[];
  readonly service: ChatService;
  readonly logger: Logger;
  readonly now?: () => number;
}

async function* single(
  event: ChatStreamEvent,
): AsyncGenerator<ChatStreamEvent> {
  await Promise.resolve();
  yield event;
}

export function createChatHandler(deps: ChatHandlerDeps): ChatHandler {
  const now = deps.now ?? Date.now;

  return async (ctx, requestId) => {
    const started = now();

    const rejection = await runAdmission(deps.stages, ctx);
    if (rejection) {
      deps.logger.log({
        requestId,
        stage: 'admission',
        outcome: 'rejected',
        status: rejection.status,
        errorCode: rejection.code,
        latencyMs: now() - started,
      });
      return {
        status: rejection.status,
        ...(rejection.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: rejection.retryAfterSeconds }),
        events: single({
          type: 'error',
          error: {
            code: rejection.code,
            ...(rejection.retryAfterSeconds === undefined
              ? {}
              : { retryAfterSeconds: rejection.retryAfterSeconds }),
          },
        }),
      };
    }

    const request = ctx.request;
    const config = ctx.config;
    if (!request || !config) {
      // A chain that admits without filling these in is a wiring bug. Refuse rather than guess.
      deps.logger.log({
        requestId,
        stage: 'admission',
        outcome: 'failed',
        status: 503,
      });
      return {
        status: 503,
        events: single({ type: 'error', error: { code: 'unavailable' } }),
      };
    }

    const stream = deps.service.stream({ request, config, signal: ctx.signal });
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    const opening = first.done ? undefined : first.value;

    if (opening === undefined || opening.type === 'error') {
      void iterator.return?.();
      const code =
        opening?.type === 'error' ? opening.error.code : 'unavailable';
      const status = statusForCode(code);
      deps.logger.log({
        requestId,
        stage: 'stream',
        outcome: 'rejected',
        status,
        errorCode: code,
        latencyMs: now() - started,
      });
      const retryAfter =
        opening?.type === 'error' ? opening.error.retryAfterSeconds : undefined;
      return {
        status,
        ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
        events: single(
          opening ?? { type: 'error', error: { code: 'unavailable' } },
        ),
      };
    }

    async function* rest(): AsyncGenerator<ChatStreamEvent> {
      let outcome: 'completed' | 'interrupted' | 'client_closed' =
        'interrupted';
      try {
        yield opening as ChatStreamEvent;
        for (;;) {
          const next = await iterator.next();
          if (next.done) break;
          if (next.value.type === 'done') outcome = 'completed';
          yield next.value;
        }
      } finally {
        if (ctx.signal.aborted && outcome !== 'completed')
          outcome = 'client_closed';
        void iterator.return?.();
        deps.logger.log({
          requestId,
          stage: 'stream',
          outcome,
          status: 200,
          latencyMs: now() - started,
        });
      }
    }

    return { status: 200, events: rest() };
  };
}
