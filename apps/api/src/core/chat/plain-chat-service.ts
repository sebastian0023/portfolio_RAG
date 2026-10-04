import type {
  ChatErrorCode,
  ChatStreamEvent,
  LLMEvent,
  LLMErrorCode,
} from '@portfolio/shared';
import { withMetrics } from '../llm/metered-provider.js';
import type { Logger } from '../ports/logger.js';
import type { ChatService, ChatServiceInput } from './chat-handler.js';
import { PLAIN_SYSTEM_PROMPT, normalizeHistory } from './prompt.js';

// Before the answer begins every provider failure is a plain refusal; after it begins it is an interruption.
// Throttling is not surfaced as rate_limited: that code means this API's own limit, with a retry time.
const REFUSAL: ChatErrorCode = 'unavailable';

export interface PlainChatServiceDeps {
  readonly logger: Logger;
  readonly now?: () => number;
}

// Plain-LLM service for Phase 3 (no retrieval): accepted -> delta* -> done{coverage:'none'}. The stream is
// opened first and `accepted` is sent only once the provider has produced something, so an immediate
// provider failure (kill switch, throttling) is a refusal with a status rather than a half-started answer.
export function createPlainChatService(
  deps: PlainChatServiceDeps,
): ChatService {
  return {
    async *stream(input: ChatServiceInput): AsyncGenerator<ChatStreamEvent> {
      const { request, config, signal, provider, quota, requestId } = input;
      const { limits } = config;
      const deadline = AbortSignal.timeout(limits.timeoutSeconds * 1000);
      const combined = AbortSignal.any([signal, deadline]);

      const events = withMetrics(
        provider,
        deps.logger,
        requestId,
        deps.now,
      ).stream(
        {
          systemPrompt: PLAIN_SYSTEM_PROMPT,
          history: normalizeHistory(request.history, limits.historyTurns),
          userMessage: request.question,
          maxOutputTokens: limits.outputMaxTokens,
        },
        combined,
      );
      const iterator = events[Symbol.asyncIterator]();

      try {
        let next = await safeNext(iterator);
        if (next.kind === 'error') {
          if (!signal.aborted) {
            yield { type: 'error', error: { code: REFUSAL } };
          }
          return;
        }
        if (next.kind === 'end') {
          yield { type: 'error', error: { code: 'unavailable' } };
          return;
        }

        yield { type: 'accepted', quota };
        for (;;) {
          const event = next.event;
          if (event.type === 'delta') {
            if (event.text !== '') yield { type: 'delta', text: event.text };
          } else if (event.type === 'done') {
            yield { type: 'done', coverage: 'none', cited: [] };
            return;
          }
          next = await safeNext(iterator);
          if (next.kind === 'error') {
            // A viewer who left gets nothing; a deadline or provider failure is an interruption.
            if (!signal.aborted) {
              yield { type: 'error', error: { code: 'interrupted' } };
            }
            return;
          }
          if (next.kind === 'end') {
            yield { type: 'error', error: { code: 'interrupted' } };
            return;
          }
        }
      } finally {
        await iterator.return?.();
      }
    },
  };
}

type Step =
  | { readonly kind: 'event'; readonly event: LLMEvent }
  | { readonly kind: 'error'; readonly code: LLMErrorCode }
  | { readonly kind: 'end' };

// Folds provider error events and thrown errors into one shape. Usage events are consumed here because the
// metrics decorator has already recorded them.
async function safeNext(iterator: AsyncIterator<LLMEvent>): Promise<Step> {
  for (;;) {
    let result: IteratorResult<LLMEvent>;
    try {
      result = await iterator.next();
    } catch {
      return { kind: 'error', code: 'internal' };
    }
    if (result.done) return { kind: 'end' };
    if (result.value.type === 'error') {
      return { kind: 'error', code: result.value.error.code };
    }
    if (result.value.type === 'usage') continue;
    return { kind: 'event', event: result.value };
  }
}
