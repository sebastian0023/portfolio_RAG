import type { ChatStreamEvent } from '@portfolio/shared';
import { describe, expect, test } from 'vitest';
import {
  configFrom,
  wiringStage,
  context,
  memoryLogger,
  rawConfig,
} from '../../testing/helpers.js';
import {
  byteCapStage,
  configStage,
  contentTypeStage,
  schemaStage,
} from './admission.js';
import { createChatHandler, type ChatService } from './chat-handler.js';
import { unavailableService } from './unavailable-service.js';

const stages = () => [
  contentTypeStage,
  byteCapStage,
  schemaStage,
  configStage(configFrom(rawConfig())),
  wiringStage,
];

const serviceOf = (events: ChatStreamEvent[]): ChatService => ({
  async *stream() {
    for (const event of events) yield event;
  },
});

async function collect(events: AsyncIterable<ChatStreamEvent>) {
  const out: ChatStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const accepted: ChatStreamEvent = {
  type: 'accepted',
  quota: { left: 29, limit: 30, principal: 'guest' },
};
const done: ChatStreamEvent = { type: 'done', coverage: 'none', cited: [] };

describe('chat handler (ADR-049)', () => {
  test('streams a successful answer with status 200 and logs completion', async () => {
    const logger = memoryLogger();
    const handler = createChatHandler({
      stages: stages(),
      service: serviceOf([accepted, { type: 'delta', text: 'hi' }, done]),
      logger,
    });
    const response = await handler(context(), 'req-1');
    expect(response.status).toBe(200);
    expect(await collect(response.events)).toEqual([
      accepted,
      { type: 'delta', text: 'hi' },
      done,
    ]);
    expect(logger.events.at(-1)).toMatchObject({
      requestId: 'req-1',
      stage: 'stream',
      outcome: 'completed',
      status: 200,
    });
  });

  test('turns an admission rejection into a status plus one error event', async () => {
    const logger = memoryLogger();
    const handler = createChatHandler({
      stages: stages(),
      service: serviceOf([accepted, done]),
      logger,
    });
    const response = await handler(context({ contentType: 'text/plain' }), 'r');
    expect(response.status).toBe(415);
    expect(await collect(response.events)).toEqual([
      { type: 'error', error: { code: 'unavailable' } },
    ]);
    expect(logger.events[0]).toMatchObject({
      outcome: 'rejected',
      stage: 'admission',
      status: 415,
    });
  });

  test('never calls the service for a rejected request', async () => {
    let calls = 0;
    const service: ChatService = {
      async *stream() {
        calls += 1;
        yield accepted;
      },
    };
    const handler = createChatHandler({
      stages: stages(),
      service,
      logger: memoryLogger(),
    });
    await handler(
      context({ json: { question: 'x'.repeat(501), history: [] } }),
      'r',
    );
    expect(calls).toBe(0);
  });

  test('maps a first-event error to the status of its code and keeps retryAfter', async () => {
    const handler = createChatHandler({
      stages: stages(),
      service: serviceOf([
        {
          type: 'error',
          error: { code: 'rate_limited', retryAfterSeconds: 12 },
        },
      ]),
      logger: memoryLogger(),
    });
    const response = await handler(context(), 'r');
    expect(response.status).toBe(429);
    expect(response.retryAfterSeconds).toBe(12);
    expect(await collect(response.events)).toEqual([
      { type: 'error', error: { code: 'rate_limited', retryAfterSeconds: 12 } },
    ]);
  });

  test('the placeholder service always refuses with 503', async () => {
    const handler = createChatHandler({
      stages: stages(),
      service: unavailableService,
      logger: memoryLogger(),
    });
    const response = await handler(context(), 'r');
    expect(response.status).toBe(503);
  });

  test('an empty service stream is refused rather than answered', async () => {
    const handler = createChatHandler({
      stages: stages(),
      service: serviceOf([]),
      logger: memoryLogger(),
    });
    expect((await handler(context(), 'r')).status).toBe(503);
  });

  test('records client_closed when the viewer disconnects mid-stream', async () => {
    const logger = memoryLogger();
    const controller = new AbortController();
    const handler = createChatHandler({
      stages: stages(),
      service: serviceOf([accepted, { type: 'delta', text: 'a' }, done]),
      logger,
    });
    const response = await handler(context({ signal: controller.signal }), 'r');
    const iterator = response.events[Symbol.asyncIterator]();
    await iterator.next();
    controller.abort();
    await iterator.return?.();
    expect(logger.events.at(-1)).toMatchObject({ outcome: 'client_closed' });
  });

  test('records interrupted when the stream ends without done', async () => {
    const logger = memoryLogger();
    const handler = createChatHandler({
      stages: stages(),
      service: serviceOf([accepted, { type: 'delta', text: 'a' }]),
      logger,
    });
    const response = await handler(context(), 'r');
    await collect(response.events);
    expect(logger.events.at(-1)).toMatchObject({ outcome: 'interrupted' });
  });
});

describe('chat handler wiring', () => {
  test('refuses when no stage supplied a provider or quota (fail closed)', async () => {
    const handler = createChatHandler({
      stages: [
        contentTypeStage,
        byteCapStage,
        schemaStage,
        configStage(configFrom(rawConfig())),
      ],
      service: serviceOf([accepted, done]),
      logger: memoryLogger(),
    });
    const response = await handler(context(), 'r');
    expect(response.status).toBe(503);
  });
});
