import type { LLMEvent, LLMProvider, LLMRequest } from '@portfolio/shared';
import type { Built, Scenario } from './llm-provider-contract.js';

// Provider whose backend is a scenario. It is the reference behaviour the contract suite describes.
export function fakeProvider(scenario: Scenario): Built {
  let calls = 0;
  let observed: Built['observed'] extends () => infer R ? R : never;

  const provider: LLMProvider = {
    id: 'fake',
    async *stream(request: LLMRequest, signal?: AbortSignal) {
      if (signal?.aborted) {
        yield { type: 'error', error: { code: 'cancelled', retryable: false } };
        return;
      }
      calls += 1;
      observed = {
        maxOutputTokens: request.maxOutputTokens,
        systemPrompt: request.systemPrompt,
        messages: [
          ...request.history.map((t) => ({ role: t.role, text: t.text })),
          { role: 'user', text: request.userMessage },
        ],
      };
      await Promise.resolve();
      if (scenario.kind === 'error') {
        yield {
          type: 'error',
          error: {
            code: scenario.code,
            retryable: scenario.code === 'throttled',
          },
        };
        return;
      }
      if (scenario.kind === 'hang') {
        yield { type: 'delta', text: 'partial' };
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        yield { type: 'error', error: { code: 'cancelled', retryable: false } };
        return;
      }
      for (const text of scenario.chunks) yield { type: 'delta', text };
      if (scenario.usage) yield { type: 'usage', usage: scenario.usage };
      yield { type: 'done', stopReason: scenario.stop ?? 'end' };
    },
  };

  return { provider, calls: () => calls, observed: () => observed };
}

// Provider that replays a fixed event list and records what it was asked. For service-level tests.
export function scriptedProvider(events: readonly LLMEvent[]): LLMProvider & {
  readonly requests: LLMRequest[];
  readonly signals: (AbortSignal | undefined)[];
} {
  const requests: LLMRequest[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  return {
    id: 'scripted',
    requests,
    signals,
    async *stream(request, signal) {
      requests.push(request);
      signals.push(signal);
      await Promise.resolve();
      for (const event of events) yield event;
    },
  };
}
