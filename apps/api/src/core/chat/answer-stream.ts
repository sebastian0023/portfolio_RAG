import type {
  ChatErrorCode,
  ChatStreamEvent,
  LLMEvent,
  LLMErrorCode,
  LLMProvider,
  LLMRequest,
  QuotaState,
} from '@portfolio/shared';
import { withMetrics } from '../llm/metered-provider.js';
import type { Logger } from '../ports/logger.js';

// Before the answer begins every provider failure is a plain refusal; after it begins it is an interruption.
// Throttling is not surfaced as rate_limited: that code means this API's own limit, with a retry time.
const REFUSAL: ChatErrorCode = 'unavailable';

export interface AnswerStreamOptions {
  readonly logger: Logger;
  readonly now?: () => number;
  readonly requestId: string;
  readonly provider: LLMProvider;
  readonly request: LLMRequest;
  // The viewer's own signal, to tell a viewer who left from a deadline or a provider failure.
  readonly viewer: AbortSignal;
  // The viewer's signal combined with the request deadline.
  readonly signal: AbortSignal;
  readonly quota: QuotaState;
  // Sent right after `accepted` and before the first word (ADR-049: sources precede the answer).
  readonly afterAccepted?: readonly ChatStreamEvent[];
  // Decides coverage and citations from the full answer text.
  readonly finish: (answer: string) => {
    readonly coverage: 'answered' | 'none';
    readonly cited: readonly number[];
  };
}

// Opens the provider stream first and sends `accepted` only once the provider has produced something, so an
// immediate provider failure (kill switch, throttling) is a refusal with a status rather than a half-started
// answer: accepted -> afterAccepted* -> delta* -> done.
export async function* streamAnswer(
  options: AnswerStreamOptions,
): AsyncGenerator<ChatStreamEvent> {
  const events = withMetrics(
    options.provider,
    options.logger,
    options.requestId,
    options.now,
  ).stream(options.request, options.signal);
  const iterator = events[Symbol.asyncIterator]();
  let answer = '';

  try {
    let next = await safeNext(iterator);
    if (next.kind === 'error') {
      if (!options.viewer.aborted) {
        yield { type: 'error', error: { code: REFUSAL } };
      }
      return;
    }
    if (next.kind === 'end') {
      yield { type: 'error', error: { code: 'unavailable' } };
      return;
    }

    yield { type: 'accepted', quota: options.quota };
    for (const event of options.afterAccepted ?? []) yield event;
    for (;;) {
      const event = next.event;
      if (event.type === 'delta') {
        if (event.text !== '') {
          answer += event.text;
          yield { type: 'delta', text: event.text };
        }
      } else if (event.type === 'done') {
        const { coverage, cited } = options.finish(answer);
        yield { type: 'done', coverage, cited: [...cited] };
        return;
      }
      next = await safeNext(iterator);
      if (next.kind === 'error') {
        // A viewer who left gets nothing; a deadline or provider failure is an interruption.
        if (!options.viewer.aborted) {
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
