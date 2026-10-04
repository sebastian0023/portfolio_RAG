import { describe, expect, test } from 'vitest';
import { createChatHandler } from '../../core/chat/chat-handler.js';
import {
  byteCapStage,
  configStage,
  contentTypeStage,
  schemaStage,
} from '../../core/chat/admission.js';
import type { ChatService } from '../../core/chat/chat-handler.js';
import {
  configFrom,
  wiringStage,
  context,
  rawConfig,
} from '../../testing/helpers.js';
import { createHttpApp } from '../http/app.js';
import { createStreamHandler } from '../lambda/stream-handler.js';
import { createJsonLogger } from './json-logger.js';

const CANARY_QUESTION = 'CANARY-QUESTION-7f3a';
const CANARY_ANSWER = 'CANARY-ANSWER-91bc';
const CANARY_TOKEN = 'CANARY-TOKEN-55de';

describe('log redaction (ADR-028)', () => {
  test('one full request leaves no question, answer, or auth value in the logs', async () => {
    const lines: string[] = [];
    const logger = createJsonLogger((line) => lines.push(line));
    const service: ChatService = {
      async *stream(input) {
        void input.request.question;
        yield {
          type: 'accepted',
          quota: { left: 1, limit: 30, principal: 'guest' },
        };
        yield { type: 'delta', text: CANARY_ANSWER };
        yield { type: 'done', coverage: 'none', cited: [] };
      },
    };
    const handleChat = createChatHandler({
      stages: [
        contentTypeStage,
        byteCapStage,
        schemaStage,
        configStage(configFrom(rawConfig())),
        wiringStage,
      ],
      service,
      logger,
    });
    const handler = createStreamHandler({
      app: createHttpApp({ handleChat, newRequestId: () => 'req' }),
      httpResponseStream: { from: (stream) => stream },
      logger,
      newRequestId: () => 'req',
    });
    await handler(
      {
        rawPath: '/api/chat',
        headers: {
          host: 'example.test',
          'content-type': 'application/json',
          'x-auth-token': CANARY_TOKEN,
          'cloudfront-viewer-address': '203.0.113.9:4444',
        },
        requestContext: { http: { method: 'POST' } },
        body: JSON.stringify({
          question: CANARY_QUESTION,
          history: [{ role: 'user', text: CANARY_QUESTION }],
        }),
      },
      {
        write: () => true,
        end: () => undefined,
        on() {
          return this;
        },
      },
    );
    expect(lines.length).toBeGreaterThan(0);
    const all = lines.join('');
    for (const canary of [
      CANARY_QUESTION,
      CANARY_ANSWER,
      CANARY_TOKEN,
      '203.0.113.9',
    ]) {
      expect(all).not.toContain(canary);
    }
    for (const line of lines) {
      expect(() => JSON.parse(line) as unknown).not.toThrow();
    }
    void context;
  });
});
