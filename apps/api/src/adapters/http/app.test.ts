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
  refusingGuestPass,
  memoryLogger,
  rawConfig,
} from '../../testing/helpers.js';
import type { GuestPassHandler } from '../../core/guest/guest-pass-handler.js';
import { createHttpApp } from './app.js';

const answering: ChatService = {
  async *stream() {
    yield {
      type: 'accepted',
      quota: { left: 29, limit: 30 },
    };
    yield { type: 'delta', text: 'hello' };
    yield { type: 'done', coverage: 'none', cited: [] };
  },
};

function app(service: ChatService = answering, raw = rawConfig()) {
  const handleChat = createChatHandler({
    stages: [
      contentTypeStage,
      byteCapStage,
      schemaStage,
      configStage(configFrom(raw)),
      wiringStage,
    ],
    service,
    logger: memoryLogger(),
  });
  return createHttpApp({
    handleChat,
    handleGuestPass: refusingGuestPass,
    newRequestId: () => 'req',
  });
}

const post = (body: string | null, headers: Record<string, string> = {}) =>
  new Request('https://example.test/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === null ? {} : { body }),
  });

const valid = JSON.stringify({ question: 'hi', history: [] });

describe('HTTP app status table (ADR-049)', () => {
  test('streams a 200 SSE answer with the required headers', async () => {
    const response = await app().fetch(post(valid));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'text/event-stream; charset=utf-8',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const text = await response.text();
    expect(text).toBe(
      [
        'data: {"type":"accepted","quota":{"left":29,"limit":30}}',
        'data: {"type":"delta","text":"hello"}',
        'data: {"type":"done","coverage":"none","cited":[]}',
      ]
        .map((frame) => `${frame}\n\n`)
        .join(''),
    );
  });

  const refusal = async (response: Response, status: number, code: string) => {
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toBe(
      `data: {"type":"error","error":{"code":"${code}"}}\n\n`,
    );
  };

  test.each([
    [
      'wrong content type',
      () => post(valid, { 'content-type': 'text/plain' }),
      415,
      'unavailable',
    ],
    ['bad JSON', () => post('{nope'), 400, 'unavailable'],
    ['schema violation', () => post('{"question":1}'), 400, 'unavailable'],
    [
      'question too long',
      () => post(JSON.stringify({ question: 'q'.repeat(501), history: [] })),
      400,
      'too_long',
    ],
    [
      'body over 8 KB',
      () =>
        post(
          JSON.stringify({ question: 'q', history: [], pad: 'x'.repeat(9000) }),
        ),
      413,
      'too_long',
    ],
  ])('%s', async (_name, build, status, code) => {
    await refusal(await app().fetch(build()), status, code);
  });

  test('refuses with 503 when config is missing', async () => {
    const response = await app(answering, {} as Record<string, string>).fetch(
      post(valid),
    );
    await refusal(response, 503, 'unavailable');
  });

  test('refuses OPTIONS and other methods with 405 and no CORS headers', async () => {
    for (const method of ['OPTIONS', 'GET', 'PUT', 'DELETE']) {
      const response = await app().fetch(
        new Request('https://example.test/api/chat', {
          method,
          headers: {
            origin: 'https://evil.example',
            'access-control-request-method': 'POST',
          },
        }),
      );
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      for (const [name] of response.headers) {
        expect(name.startsWith('access-control-')).toBe(false);
      }
    }
  });

  test('answers unknown API paths with a 404 SSE error, never HTML', async () => {
    const response = await app().fetch(
      new Request('https://example.test/api/nope'),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).not.toContain('<');
  });

  test('sets Retry-After on a rate-limited refusal', async () => {
    const limited: ChatService = {
      async *stream() {
        yield {
          type: 'error',
          error: { code: 'rate_limited', retryAfterSeconds: 7 },
        };
      },
    };
    const response = await app(limited).fetch(post(valid));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('7');
  });

  test('turns a mid-stream failure into one generic interrupted event', async () => {
    const failing: ChatService = {
      async *stream() {
        yield {
          type: 'accepted',
          quota: { left: 1, limit: 30 },
        };
        await Promise.resolve();
        throw new Error('secret provider detail');
      },
    };
    const text = await (await app(failing).fetch(post(valid))).text();
    expect(text).toContain('"code":"interrupted"');
    expect(text).not.toContain('secret');
  });

  test('a handler that throws yields a sanitized 503', async () => {
    const boom = createHttpApp({
      handleChat: () => Promise.reject(new Error('internal detail')),
      handleGuestPass: refusingGuestPass,
      newRequestId: () => 'r',
    });
    const response = await boom.fetch(post(valid));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('internal');
  });
});

describe('guest pass route (ADR-052)', () => {
  const issuing: GuestPassHandler = () =>
    Promise.resolve({
      status: 200,
      body: { pass: 'v1.a.b', expiresAt: 1_900_000_000 },
    });

  function guestApp(handleGuestPass: GuestPassHandler) {
    return createHttpApp({
      handleChat: createChatHandler({
        stages: [],
        service: answering,
        logger: memoryLogger(),
      }),
      handleGuestPass,
      newRequestId: () => 'req',
    });
  }

  const postPass = (body = '{"token":"t"}') =>
    new Request('https://example.test/api/guest-pass', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

  test('answers JSON that is never cached or sniffed', async () => {
    const response = await guestApp(issuing).fetch(postPass());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toEqual({
      pass: 'v1.a.b',
      expiresAt: 1_900_000_000,
    });
  });

  test('passes refusals through with their status and Retry-After', async () => {
    const limited = guestApp(() =>
      Promise.resolve({
        status: 429,
        retryAfterSeconds: 12,
        body: { error: 'rate_limited', retryAfterSeconds: 12 },
      }),
    );
    const response = await limited.fetch(postPass());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('12');
    expect(await response.json()).toEqual({
      error: 'rate_limited',
      retryAfterSeconds: 12,
    });
  });

  test('hands the request body and the headers to the handler', async () => {
    let seen: { contentType: string | null; header: string | null } | undefined;
    const app = guestApp((ctx) => {
      seen = {
        contentType: ctx.contentType,
        header: ctx.headers.get('cloudfront-viewer-address'),
      };
      return Promise.resolve({
        status: 200,
        body: { pass: 'p', expiresAt: 1 },
      });
    });
    await app.fetch(
      new Request('https://example.test/api/guest-pass', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cloudfront-viewer-address': '203.0.113.9:1',
        },
        body: '{}',
      }),
    );
    expect(seen).toEqual({
      contentType: 'application/json',
      header: '203.0.113.9:1',
    });
  });

  test('refuses every other method, including OPTIONS, without CORS headers', async () => {
    for (const method of ['GET', 'OPTIONS', 'PUT']) {
      const response = await guestApp(issuing).fetch(
        new Request('https://example.test/api/guest-pass', {
          method,
          headers: { origin: 'https://evil.example' },
        }),
      );
      expect(response.status).toBe(405);
      for (const [name] of response.headers)
        expect(name.startsWith('access-control-')).toBe(false);
    }
  });

  test('a handler that throws yields a sanitized 503', async () => {
    const response = await guestApp(() =>
      Promise.reject(new Error('turnstile secret abc')),
    ).fetch(postPass());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
  });
});
