import { describe, expect, test } from 'vitest';
import { memoryLogger } from '../../testing/helpers.js';
import {
  createStreamHandler,
  type HttpResponseStreamApi,
} from './stream-handler.js';

function fakeStream() {
  const written: string[] = [];
  const listeners: Record<string, Array<() => void>> = {};
  let ended = false;
  const stream: LambdaResponseStream = {
    write: (chunk) => {
      written.push(
        typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    },
    end: () => {
      ended = true;
    },
    on(event, listener) {
      (listeners[event] ??= []).push(listener);
      return this;
    },
  };
  return {
    stream,
    written,
    isEnded: () => ended,
    emit: (event: string) => listeners[event]?.forEach((l) => l()),
  };
}

function setup(app: { fetch(request: Request): Response | Promise<Response> }) {
  const fake = fakeStream();
  let metadata:
    { statusCode: number; headers?: Record<string, string> } | undefined;
  const httpResponseStream: HttpResponseStreamApi = {
    from: (stream, meta) => {
      metadata = meta;
      return stream;
    },
  };
  const logger = memoryLogger();
  const handler = createStreamHandler({
    app,
    httpResponseStream,
    logger,
    newRequestId: () => 'req',
  });
  return { fake, logger, handler, metadata: () => metadata };
}

const event = (overrides: Record<string, unknown> = {}) => ({
  rawPath: '/api/chat',
  rawQueryString: '',
  headers: { host: 'example.test', 'content-type': 'application/json' },
  requestContext: { http: { method: 'POST' } },
  body: '{"question":"hi","history":[]}',
  isBase64Encoded: false,
  ...overrides,
});

describe('Lambda stream handler', () => {
  test('passes method, path, headers, and body to the app and streams the response', async () => {
    let seen: Request | undefined;
    const { fake, handler, metadata } = setup({
      fetch: (request) => {
        seen = request;
        return new Response('data: 1\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });
    await handler(event(), fake.stream);
    expect(seen?.method).toBe('POST');
    expect(new URL(seen?.url ?? '').pathname).toBe('/api/chat');
    expect(seen?.headers.get('content-type')).toBe('application/json');
    expect(await seen?.text()).toBe('{"question":"hi","history":[]}');
    expect(metadata()).toMatchObject({
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    expect(fake.written.join('')).toBe('data: 1\n\n');
    expect(fake.isEnded()).toBe(true);
  });

  test('decodes a base64 body', async () => {
    let body = '';
    const { fake, handler } = setup({
      fetch: async (request) => {
        body = await request.text();
        return new Response('');
      },
    });
    await handler(
      event({
        body: Buffer.from('héllo').toString('base64'),
        isBase64Encoded: true,
      }),
      fake.stream,
    );
    expect(body).toBe('héllo');
  });

  test('aborts the request signal when the response stream closes', async () => {
    let signal: AbortSignal | undefined;
    const { fake, handler } = setup({
      fetch: (request) => {
        signal = request.signal;
        return new Response('x');
      },
    });
    await handler(event(), fake.stream);
    expect(signal?.aborted).toBe(false);
    fake.emit('close');
    expect(signal?.aborted).toBe(true);
  });

  test('aborts and cancels the body when a write fails', async () => {
    let cancelled = false;
    let signal: AbortSignal | undefined;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('data: 1\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { fake, handler } = setup({
      fetch: (request) => {
        signal = request.signal;
        return new Response(body);
      },
    });
    fake.stream.write = () => {
      throw new Error('socket closed');
    };
    await handler(event(), fake.stream);
    expect(signal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
    expect(fake.isEnded()).toBe(true);
  });

  test('answers a malformed event with a 400 SSE error and never calls the app', async () => {
    let calls = 0;
    const { fake, handler, metadata } = setup({
      fetch: () => {
        calls += 1;
        return new Response('');
      },
    });
    await handler({ not: 'a function url event' }, fake.stream);
    expect(calls).toBe(0);
    expect(metadata()?.statusCode).toBe(400);
    expect(fake.written.join('')).toContain('"code":"unavailable"');
  });

  test('a throwing app yields a sanitized 503 and logs metadata only', async () => {
    const { fake, handler, logger, metadata } = setup({
      fetch: () => {
        throw new Error('internal detail token=abc');
      },
    });
    await handler(event(), fake.stream);
    expect(metadata()?.statusCode).toBe(503);
    expect(fake.written.join('')).not.toContain('internal');
    expect(JSON.stringify(logger.events)).not.toContain('abc');
    expect(logger.events[0]).toMatchObject({
      stage: 'transport',
      outcome: 'failed',
    });
  });
});
