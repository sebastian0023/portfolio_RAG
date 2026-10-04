import type {
  LLMEvent,
  LLMProvider,
  LLMRequest,
  LLMStopReason,
} from '@portfolio/shared';
import type { Logger } from '../ports/logger.js';

// Decorator (ADR-040) that records model metrics without touching the stream: events, errors, usage, and
// cancellation pass through unchanged, and it logs numbers only, never request or answer text (ADR-028).
export function withMetrics(
  inner: LLMProvider,
  logger: Logger,
  requestId: string,
  now: () => number = Date.now,
): LLMProvider {
  return {
    id: inner.id,
    async *stream(
      request: LLMRequest,
      signal?: AbortSignal,
    ): AsyncGenerator<LLMEvent> {
      const started = now();
      let firstEventMs: number | undefined;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let stopReason: LLMStopReason | undefined;
      let errorCode: string | undefined;
      try {
        for await (const event of inner.stream(request, signal)) {
          firstEventMs ??= now() - started;
          if (event.type === 'usage') {
            inputTokens = event.usage.inputTokens;
            outputTokens = event.usage.outputTokens;
          } else if (event.type === 'done') {
            stopReason = event.stopReason;
          } else if (event.type === 'error') {
            errorCode = event.error.code;
          }
          yield event;
        }
      } finally {
        logger.log({
          requestId,
          stage: 'model',
          outcome:
            errorCode === 'cancelled'
              ? 'client_closed'
              : errorCode !== undefined
                ? 'failed'
                : stopReason !== undefined
                  ? 'completed'
                  : 'interrupted',
          latencyMs: now() - started,
          ...(firstEventMs === undefined ? {} : { firstEventMs }),
          ...(inputTokens === undefined ? {} : { inputTokens }),
          ...(outputTokens === undefined ? {} : { outputTokens }),
          ...(stopReason === undefined ? {} : { stopReason }),
          ...(errorCode === undefined ? {} : { errorCode }),
        });
      }
    },
  };
}
