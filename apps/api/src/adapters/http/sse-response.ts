import { encodeSseEvent, type ChatStreamEvent } from '@portfolio/shared';

const encoder = new TextEncoder();

const INTERRUPTED: ChatStreamEvent = {
  type: 'error',
  error: { code: 'interrupted' },
};

export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

// Streams events as data-only SSE frames (ADR-049). A failure while producing events becomes one generic
// `interrupted` event: the raw error is never forwarded and never logged here.
export function sseResponse(
  status: number,
  events: AsyncIterable<ChatStreamEvent>,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  const iterator = events[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
        } else {
          controller.enqueue(encoder.encode(encodeSseEvent(next.value)));
        }
      } catch {
        controller.enqueue(encoder.encode(encodeSseEvent(INTERRUPTED)));
        controller.close();
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
  return new Response(body, {
    status,
    headers: { ...SSE_HEADERS, ...extraHeaders },
  });
}

export function errorResponse(
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  return new Response(
    encodeSseEvent({ type: 'error', error: { code: 'unavailable' } }),
    { status, headers: { ...SSE_HEADERS, ...extraHeaders } },
  );
}
