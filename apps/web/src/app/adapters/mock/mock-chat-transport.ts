import {
  MAX_QUESTION_LENGTH,
  type ChatRequest,
  type ChatStreamEvent,
} from '@portfolio/shared';
import {
  NetworkError,
  type ChatTransport,
} from '../../core/ports/chat-transport';
import {
  answerFor,
  citedIn,
  NO_COVERAGE_TEXT,
  sourcesFor,
  tokenize,
} from './fixtures';
import { delay, type MockConfig, type MockOutcome } from './mock-config';

// Deterministic stand-in for the chat API. It emits the same events the Lambda will (ADR-048),
// including quota reservation, so the facade is exercised exactly as it will be in production.
export class MockChatTransport implements ChatTransport {
  constructor(private readonly config: MockConfig) {}

  async *send(
    request: ChatRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const outcome: MockOutcome = this.config.outcomes.shift() ?? 'ok';

    if (outcome === 'network') {
      await delay(300, signal);
      throw new NetworkError('offline');
    }
    if (typeof outcome === 'object' && 'error' in outcome) {
      await delay(200, signal);
      yield {
        type: 'error',
        error: {
          code: outcome.error,
          ...(outcome.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: outcome.retryAfterSeconds }),
        },
      };
      return;
    }

    // Server-side gates, cheapest first (ADR-016).
    if (request.question.length > MAX_QUESTION_LENGTH) {
      yield { type: 'error', error: { code: 'too_long' } };
      return;
    }
    if (!this.config.enabled) {
      yield { type: 'error', error: { code: 'unavailable' } };
      return;
    }
    if (this.config.siteLimited) {
      yield { type: 'error', error: { code: 'site_limit' } };
      return;
    }
    const left = this.config.guestLeft;
    if (left <= 0) {
      yield { type: 'error', error: { code: 'quota_exhausted' } };
      return;
    }

    // Reserve before the first paid step and never refund (abuse-budgets.md).
    this.config.guestLeft--;
    yield {
      type: 'accepted',
      quota: { left: left - 1, limit: this.config.guestLimit },
    };

    await delay(this.config.thinkingMs, signal);
    if (outcome === 'empty') return;
    if (outcome === 'hang') {
      await new Promise<void>((_, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        ),
      );
    }

    const answer = answerFor(request.question);
    if (!answer) {
      if (!(yield* this.words(NO_COVERAGE_TEXT, outcome, signal))) return;
      yield { type: 'done', coverage: 'none', cited: [] };
      return;
    }
    yield { type: 'sources', sources: sourcesFor(answer) };
    if (!(yield* this.words(answer.text, outcome, signal))) return;
    yield { type: 'done', coverage: 'answered', cited: citedIn(answer) };
  }

  private async *words(
    text: string,
    outcome: MockOutcome,
    signal: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent, boolean> {
    let sent = 0;
    for (const word of tokenize(text)) {
      await delay(this.config.tokenMs, signal);
      yield { type: 'delta', text: word };
      sent++;
      if (
        typeof outcome === 'object' &&
        'interruptAfter' in outcome &&
        sent >= outcome.interruptAfter
      ) {
        yield { type: 'error', error: { code: 'interrupted' } };
        return false;
      }
      if (
        typeof outcome === 'object' &&
        'hangAfter' in outcome &&
        sent >= outcome.hangAfter
      ) {
        await new Promise<void>((_, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          ),
        );
      }
    }
    return true;
  }
}
