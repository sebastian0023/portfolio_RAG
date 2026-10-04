// Contract suite every LLMProvider adapter must pass (ADR-045). A harness builds a provider whose backend
// follows a scenario, so the same assertions run against the fake and against each real adapter.
import type { LLMErrorCode, LLMEvent, LLMProvider } from '@portfolio/shared';
import { describe, expect, test } from 'vitest';

export type Scenario =
  | {
      readonly kind: 'text';
      readonly chunks: readonly string[];
      readonly usage?: { inputTokens: number; outputTokens: number };
      readonly stop?: 'end' | 'max_tokens';
    }
  | {
      readonly kind: 'error';
      readonly code: Exclude<LLMErrorCode, 'cancelled'>;
    }
  // Emits one chunk, then waits until the signal aborts.
  | { readonly kind: 'hang' };

export interface Observed {
  readonly maxOutputTokens: number | undefined;
  readonly systemPrompt: string | undefined;
  // Roles and texts in the order the backend received them, ending with the new user question.
  readonly messages: readonly { role: string; text: string }[];
}

export interface Built {
  readonly provider: LLMProvider;
  // How many times the backend was actually called (retries and pre-aborted calls show up here).
  calls(): number;
  observed(): Observed | undefined;
}

export interface Harness {
  build(scenario: Scenario): Built;
}

// A raw provider message that must never appear in any event.
export const RAW_DETAIL = 'RAW-PROVIDER-DETAIL-3c1d';

const REQUEST = {
  systemPrompt: 'system rules',
  history: [
    { role: 'user' as const, text: 'earlier question' },
    { role: 'assistant' as const, text: 'earlier answer' },
  ],
  userMessage: 'the new question',
  maxOutputTokens: 400,
};

async function collect(
  provider: LLMProvider,
  signal?: AbortSignal,
): Promise<LLMEvent[]> {
  const events: LLMEvent[] = [];
  for await (const event of provider.stream(REQUEST, signal))
    events.push(event);
  return events;
}

const within = <T>(promise: Promise<T>, ms = 2000): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('stream did not finish')), ms),
    ),
  ]);

const ERROR_CODES: Exclude<LLMErrorCode, 'cancelled'>[] = [
  'throttled',
  'unavailable',
  'invalid_request',
  'content_filtered',
  'internal',
];

export function runLlmProviderContract(name: string, harness: Harness): void {
  describe(`LLMProvider contract: ${name}`, () => {
    test('streams deltas in order, then usage once, then done last', async () => {
      const { provider } = harness.build({
        kind: 'text',
        chunks: ['Hel', 'lo', ' there'],
        usage: { inputTokens: 12, outputTokens: 3 },
      });
      const events = await collect(provider);
      expect(events).toEqual([
        { type: 'delta', text: 'Hel' },
        { type: 'delta', text: 'lo' },
        { type: 'delta', text: ' there' },
        { type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } },
        { type: 'done', stopReason: 'end' },
      ]);
    });

    test('reports max_tokens as a normal completion', async () => {
      const { provider } = harness.build({
        kind: 'text',
        chunks: ['cut'],
        stop: 'max_tokens',
      });
      expect((await collect(provider)).at(-1)).toEqual({
        type: 'done',
        stopReason: 'max_tokens',
      });
    });

    test('forwards the output cap, system prompt, and history before the question', async () => {
      const built = harness.build({ kind: 'text', chunks: ['x'] });
      await collect(built.provider);
      expect(built.observed()).toEqual({
        maxOutputTokens: 400,
        systemPrompt: 'system rules',
        messages: [
          { role: 'user', text: 'earlier question' },
          { role: 'assistant', text: 'earlier answer' },
          { role: 'user', text: 'the new question' },
        ],
      });
    });

    test.each(ERROR_CODES)(
      'maps a %s failure to one terminal error with no raw detail and no retry',
      async (code) => {
        const built = harness.build({ kind: 'error', code });
        const events = await collect(built.provider);
        // Usage may precede a refusal (a filtered answer was still billed); the error is always last and unique.
        expect(events.filter((e) => e.type === 'error')).toHaveLength(1);
        expect(events.at(-1)).toMatchObject({ type: 'error', error: { code } });
        expect(JSON.stringify(events)).not.toContain(RAW_DETAIL);
        expect(built.calls()).toBe(1);
      },
    );

    test('ends with one cancelled error when aborted mid-stream', async () => {
      const controller = new AbortController();
      const { provider } = harness.build({ kind: 'hang' });
      const events: LLMEvent[] = [];
      await within(
        (async () => {
          for await (const event of provider.stream(
            REQUEST,
            controller.signal,
          )) {
            events.push(event);
            if (event.type === 'delta') controller.abort();
          }
        })(),
      );
      expect(events[0]).toMatchObject({ type: 'delta' });
      expect(events.slice(1)).toEqual([
        { type: 'error', error: { code: 'cancelled', retryable: false } },
      ]);
    });

    test('makes no backend call when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const built = harness.build({ kind: 'text', chunks: ['x'] });
      const events = await collect(built.provider, controller.signal);
      expect(events).toEqual([
        { type: 'error', error: { code: 'cancelled', retryable: false } },
      ]);
      expect(built.calls()).toBe(0);
    });
  });
}
