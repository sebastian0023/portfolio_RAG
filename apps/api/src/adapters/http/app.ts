import { CHAT_API_PATH, GUEST_PASS_PATH } from '@portfolio/shared';
import { Hono } from 'hono';
import type { ChatHandler } from '../../core/chat/chat-handler.js';
import type { GuestPassHandler } from '../../core/guest/guest-pass-handler.js';
import { errorResponse, sseResponse } from './sse-response.js';

export interface HttpAppDeps {
  readonly handleChat: ChatHandler;
  readonly handleGuestPass: GuestPassHandler;
  readonly newRequestId: () => string;
}

// Hono is used for routing only. Every response, including refusals, is an SSE error event so the browser
// has one parser (ADR-049). No CORS headers are ever emitted: the SPA and the API share one origin.
export function createHttpApp(deps: HttpAppDeps): Hono {
  const app = new Hono();

  app.post(CHAT_API_PATH, async (c) => {
    const request = c.req.raw;
    const response = await deps.handleChat(
      {
        contentType: request.headers.get('content-type'),
        headers: request.headers,
        body: request.body,
        signal: request.signal,
      },
      deps.newRequestId(),
    );
    return sseResponse(
      response.status,
      response.events,
      response.retryAfterSeconds === undefined
        ? {}
        : { 'retry-after': String(response.retryAfterSeconds) },
    );
  });

  // The Turnstile token is traded for a one-hour pass here (ADR-052). The answer is plain JSON, never cached.
  app.post(GUEST_PASS_PATH, async (c) => {
    const request = c.req.raw;
    const response = await deps.handleGuestPass(
      {
        contentType: request.headers.get('content-type'),
        headers: request.headers,
        body: request.body,
        signal: request.signal,
      },
      deps.newRequestId(),
    );
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        ...(response.retryAfterSeconds === undefined
          ? {}
          : { 'retry-after': String(response.retryAfterSeconds) }),
      },
    });
  });

  // Every other method, including OPTIONS preflight, is refused without CORS headers.
  app.all(CHAT_API_PATH, () => errorResponse(405, { allow: 'POST' }));
  app.all(GUEST_PASS_PATH, () => errorResponse(405, { allow: 'POST' }));
  app.notFound(() => errorResponse(404));
  app.onError(() => errorResponse(503));

  return app;
}
