import { describe, expect, test } from 'vitest';
import { fakeProvider } from '../../testing/fake-llm-provider.js';
import { memoryLogger } from '../../testing/helpers.js';
import { withMetrics } from './metered-provider.js';

const request = {
  systemPrompt: 's',
  history: [],
  userMessage: 'SECRET-QUESTION',
  maxOutputTokens: 10,
};

async function run(
  provider: ReturnType<typeof withMetrics>,
  signal?: AbortSignal,
) {
  const events = [];
  for await (const e of provider.stream(request, signal)) events.push(e);
  return events;
}

describe('metered provider (ADR-040)', () => {
  test('passes events through unchanged and logs numbers only', async () => {
    const logger = memoryLogger();
    const inner = fakeProvider({
      kind: 'text',
      chunks: ['SECRET-ANSWER'],
      usage: { inputTokens: 7, outputTokens: 2 },
    }).provider;
    const events = await run(withMetrics(inner, logger, 'req-1'));
    expect(events.map((e) => e.type)).toEqual(['delta', 'usage', 'done']);
    expect(logger.events).toHaveLength(1);
    expect(logger.events[0]).toMatchObject({
      requestId: 'req-1',
      stage: 'model',
      outcome: 'completed',
      inputTokens: 7,
      outputTokens: 2,
      stopReason: 'end',
    });
    expect(JSON.stringify(logger.events)).not.toContain('SECRET');
  });

  test('records a failure with its code', async () => {
    const logger = memoryLogger();
    const inner = fakeProvider({ kind: 'error', code: 'throttled' }).provider;
    await run(withMetrics(inner, logger, 'r'));
    expect(logger.events[0]).toMatchObject({
      outcome: 'failed',
      errorCode: 'throttled',
    });
  });

  test('preserves cancellation and records client_closed', async () => {
    const logger = memoryLogger();
    const controller = new AbortController();
    const inner = fakeProvider({ kind: 'hang' }).provider;
    const events = [];
    for await (const e of withMetrics(inner, logger, 'r').stream(
      request,
      controller.signal,
    )) {
      events.push(e);
      if (e.type === 'delta') controller.abort();
    }
    expect(events.at(-1)).toEqual({
      type: 'error',
      error: { code: 'cancelled', retryable: false },
    });
    expect(logger.events[0]).toMatchObject({ outcome: 'client_closed' });
  });

  test('logs even when the consumer stops early', async () => {
    const logger = memoryLogger();
    const inner = fakeProvider({
      kind: 'text',
      chunks: ['a', 'b', 'c'],
    }).provider;
    for await (const e of withMetrics(inner, logger, 'r').stream(request)) {
      void e;
      break;
    }
    expect(logger.events).toHaveLength(1);
    expect(logger.events[0]).toMatchObject({ outcome: 'interrupted' });
  });
});
