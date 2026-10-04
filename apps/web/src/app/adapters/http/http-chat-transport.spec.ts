import type { ChatRequest, ChatStreamEvent } from '@portfolio/shared';
import { describe, expect, it } from 'vitest';
import { NetworkError } from '../../core/ports/chat-transport';
import { HttpChatTransport, ProtocolError } from './http-chat-transport';
import { sha256Hex } from './sha256';

const request: ChatRequest = { question: 'What is TypeScript?', history: [] };
const encoder = new TextEncoder();

const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
const accepted = {
  type: 'accepted',
  quota: { left: 29, limit: 30 },
};
const done = { type: 'done', coverage: 'none', cited: [] };

function stream(
  chunks: Uint8Array[],
): ReadableStream<Uint8Array> & { cancelled: boolean } {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      (body as { cancelled: boolean }).cancelled = true;
    },
  }) as ReadableStream<Uint8Array> & { cancelled: boolean };
  body.cancelled = false;
  return body;
}

const sse = (body: ReadableStream<Uint8Array>, status = 200) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });

async function collect(
  transport: HttpChatTransport,
  signal = new AbortController().signal,
): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of transport.send(request, signal)) events.push(event);
  return events;
}

describe('HttpChatTransport (ADR-049)', () => {
  it('posts the exact bytes with their SHA-256 and the required headers', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const transport = new HttpChatTransport((url, init) => {
      seen = { url: String(url), init: init as RequestInit };
      return Promise.resolve(sse(stream([encoder.encode(frame(done))])));
    });
    await collect(transport);
    expect(seen?.url).toBe('/api/chat');
    expect(seen?.init.method).toBe('POST');
    const body = seen?.init.body as Uint8Array<ArrayBuffer>;
    expect(new TextDecoder().decode(body)).toBe(JSON.stringify(request));
    const headers = seen?.init.headers as Record<string, string>;
    expect(headers['x-amz-content-sha256']).toBe(await sha256Hex(body));
    expect(headers['content-type']).toBe('application/json');
    expect(seen?.init).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
  });

  it('validates and yields every event in order', async () => {
    const text =
      frame(accepted) + frame({ type: 'delta', text: 'Hi' }) + frame(done);
    const events = await collect(
      new HttpChatTransport(() =>
        Promise.resolve(sse(stream([encoder.encode(text)]))),
      ),
    );
    expect(events.map((e) => e.type)).toEqual(['accepted', 'delta', 'done']);
  });

  it('reassembles frames split across chunks and inside a multi-byte character', async () => {
    const bytes = encoder.encode(frame({ type: 'delta', text: 'héllo' }));
    const cut = bytes.indexOf(0xc3) + 1;
    const events = await collect(
      new HttpChatTransport(() =>
        Promise.resolve(
          sse(
            stream([
              bytes.slice(0, cut),
              bytes.slice(cut, cut + 3),
              bytes.slice(cut + 3),
            ]),
          ),
        ),
      ),
    );
    expect(events).toEqual([{ type: 'delta', text: 'héllo' }]);
  });

  it('yields a refusal event from a non-2xx SSE response', async () => {
    const body = stream([
      encoder.encode(
        frame({
          type: 'error',
          error: { code: 'rate_limited', retryAfterSeconds: 7 },
        }),
      ),
    ]);
    const events = await collect(
      new HttpChatTransport(() => Promise.resolve(sse(body, 429))),
    );
    expect(events).toEqual([
      { type: 'error', error: { code: 'rate_limited', retryAfterSeconds: 7 } },
    ]);
  });

  it('maps a non-SSE 429 (Lambda throttle) to rate_limited with a 10 second retry', async () => {
    const events = await collect(
      new HttpChatTransport(() =>
        Promise.resolve(
          new Response('{"message":"Rate Exceeded"}', {
            status: 429,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    expect(events).toEqual([
      { type: 'error', error: { code: 'rate_limited', retryAfterSeconds: 10 } },
    ]);
  });

  it.each([403, 502, 504])(
    'treats a non-SSE %i from the edge as a network problem',
    async (status) => {
      await expect(
        collect(
          new HttpChatTransport(() =>
            Promise.resolve(
              new Response('<html>', {
                status,
                headers: { 'content-type': 'text/html' },
              }),
            ),
          ),
        ),
      ).rejects.toBeInstanceOf(NetworkError);
    },
  );

  it('maps a fetch rejection to NetworkError', async () => {
    await expect(
      collect(
        new HttpChatTransport(() =>
          Promise.reject(new TypeError('Failed to fetch')),
        ),
      ),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('passes an abort through unchanged so the facade can ignore it', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    await expect(
      collect(new HttpChatTransport(() => Promise.reject(abort))),
    ).rejects.toBe(abort);
  });

  it('rejects an invalid event with a ProtocolError and stops reading', async () => {
    // Later chunks keep the stream open, so the cancel below is observable.
    const body = stream([
      encoder.encode(frame(accepted) + frame({ type: 'delta', text: 1 })),
      encoder.encode(frame(done)),
      encoder.encode(frame(done)),
    ]);
    const events: ChatStreamEvent[] = [];
    const run = (async () => {
      for await (const event of new HttpChatTransport(() =>
        Promise.resolve(sse(body)),
      ).send(request, new AbortController().signal)) {
        events.push(event);
      }
    })();
    await expect(run).rejects.toBeInstanceOf(ProtocolError);
    expect(events.map((e) => e.type)).toEqual(['accepted']);
    expect(body.cancelled).toBe(true);
  });

  it('rejects unparseable JSON and an unknown event kind', async () => {
    for (const text of ['data: {nope\n\n', frame({ type: 'surprise' })]) {
      await expect(
        collect(
          new HttpChatTransport(() =>
            Promise.resolve(sse(stream([encoder.encode(text)]))),
          ),
        ),
      ).rejects.toBeInstanceOf(ProtocolError);
    }
  });

  it('cancels the response body when the consumer stops early', async () => {
    const body = stream([
      encoder.encode(frame(accepted)),
      encoder.encode(frame(done)),
    ]);
    const transport = new HttpChatTransport(() => Promise.resolve(sse(body)));
    const events = transport.send(request, new AbortController().signal);
    const iterator = events[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    expect(body.cancelled).toBe(true);
  });

  it('ends without a done event when the stream just closes (the facade shows it as interrupted)', async () => {
    const events = await collect(
      new HttpChatTransport(() =>
        Promise.resolve(sse(stream([encoder.encode(frame(accepted))]))),
      ),
    );
    expect(events.map((e) => e.type)).toEqual(['accepted']);
  });
});
