import type { ChatStreamEvent, LLMEvent, QuotaState } from '@portfolio/shared';
import { describe, expect, test } from 'vitest';
import { scriptedProvider } from '../../testing/fake-llm-provider.js';
import { memoryLogger, rawConfig } from '../../testing/helpers.js';
import { parseRuntimeConfig } from '../config/runtime-config.js';
import type { ChatServiceInput } from './chat-handler.js';
import { createPlainChatService } from './plain-chat-service.js';

const parsed = parseRuntimeConfig(rawConfig());
if (!parsed.ok) throw new Error('fixture config must be valid');
const config = parsed.config;
const quota: QuotaState = { left: 29, limit: 30 };

function input(
  provider: ChatServiceInput['provider'],
  overrides: Partial<ChatServiceInput> = {},
): ChatServiceInput {
  return {
    request: { question: 'What is TypeScript?', history: [] },
    config,
    signal: new AbortController().signal,
    provider,
    quota,
    requestId: 'req',
    ...overrides,
  };
}

async function run(
  events: LLMEvent[],
  overrides: Partial<ChatServiceInput> = {},
) {
  const provider = scriptedProvider(events);
  const logger = memoryLogger();
  const out: ChatStreamEvent[] = [];
  for await (const e of createPlainChatService({ logger }).stream(
    input(provider, overrides),
  )) {
    out.push(e);
  }
  return { out, provider, logger };
}

const error = (code: 'throttled' | 'unavailable' | 'internal' | 'cancelled') =>
  ({ type: 'error', error: { code, retryable: false } }) as const;

describe('plain chat service (Phase 3, no retrieval)', () => {
  test('emits accepted, deltas, then done with no coverage and no citations', async () => {
    const { out } = await run([
      { type: 'delta', text: 'Type' },
      { type: 'delta', text: 'Script' },
      { type: 'usage', usage: { inputTokens: 9, outputTokens: 2 } },
      { type: 'done', stopReason: 'end' },
    ]);
    expect(out).toEqual([
      { type: 'accepted', quota },
      { type: 'delta', text: 'Type' },
      { type: 'delta', text: 'Script' },
      { type: 'done', coverage: 'none', cited: [] },
    ]);
  });

  test('asks the provider with the cap, normalised history, and the question', async () => {
    const { provider } = await run([{ type: 'done', stopReason: 'end' }], {
      request: {
        question: 'next?',
        history: [
          { role: 'assistant', text: 'stray' },
          { role: 'user', text: 'one' },
          { role: 'assistant', text: 'two' },
          { role: 'user', text: 'dangling' },
        ],
      },
    });
    expect(provider.requests[0]).toMatchObject({
      maxOutputTokens: config.limits.outputMaxTokens,
      userMessage: 'next?',
      history: [
        { role: 'user', text: 'one' },
        { role: 'assistant', text: 'two' },
      ],
    });
    expect(provider.requests[0]?.systemPrompt).toMatch(/not connected/i);
  });

  test('a provider failure before any output is a refusal, not a half-started answer', async () => {
    for (const code of ['throttled', 'unavailable', 'internal'] as const) {
      const { out } = await run([error(code)]);
      expect(out).toEqual([{ type: 'error', error: { code: 'unavailable' } }]);
    }
  });

  test('a failure after output began is an interruption', async () => {
    const { out } = await run([
      { type: 'delta', text: 'partial' },
      error('unavailable'),
    ]);
    expect(out.map((e) => e.type)).toEqual(['accepted', 'delta', 'error']);
    expect(out.at(-1)).toEqual({
      type: 'error',
      error: { code: 'interrupted' },
    });
  });

  test('a stream that ends without done is an interruption; an empty one is a refusal', async () => {
    expect((await run([{ type: 'delta', text: 'x' }])).out.at(-1)).toEqual({
      type: 'error',
      error: { code: 'interrupted' },
    });
    expect((await run([])).out).toEqual([
      { type: 'error', error: { code: 'unavailable' } },
    ]);
  });

  test('a viewer who disconnected gets no error event', async () => {
    const controller = new AbortController();
    controller.abort();
    const { out } = await run([error('cancelled')], {
      signal: controller.signal,
    });
    expect(out).toEqual([]);
  });

  test('the provider sees a signal that fires on viewer disconnect and on the deadline', async () => {
    const controller = new AbortController();
    const { provider } = await run([{ type: 'done', stopReason: 'end' }], {
      signal: controller.signal,
    });
    const passed = provider.signals[0];
    expect(passed).toBeDefined();
    expect(passed?.aborted).toBe(false);
    controller.abort();
    expect(passed?.aborted).toBe(true);
  });

  test('never emits sources or empty deltas', async () => {
    const { out } = await run([
      { type: 'delta', text: '' },
      { type: 'delta', text: 'ok' },
      { type: 'done', stopReason: 'max_tokens' },
    ]);
    expect(out.some((e) => e.type === 'sources')).toBe(false);
    expect(out.filter((e) => e.type === 'delta')).toEqual([
      { type: 'delta', text: 'ok' },
    ]);
  });

  test('logs model metrics without the question', async () => {
    const { logger } = await run([
      { type: 'delta', text: 'x' },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } },
      { type: 'done', stopReason: 'end' },
    ]);
    expect(logger.events[0]).toMatchObject({
      stage: 'model',
      requestId: 'req',
      inputTokens: 3,
    });
    expect(JSON.stringify(logger.events)).not.toContain('TypeScript');
  });
});
