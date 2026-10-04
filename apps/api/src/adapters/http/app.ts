import { CHAT_API_PATH } from '@portfolio/shared';
import { Hono } from 'hono';
import type { ChatHandler } from '../../core/chat/chat-handler.js';
import { errorResponse, sseResponse } from './sse-response.js';

export interface HttpAppDeps {
  readonly handleChat: ChatHandler;
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

  // Every other method, including OPTIONS preflight, is refused without CORS headers.
  app.all(CHAT_API_PATH, () => errorResponse(405, { allow: 'POST' }));
  app.notFound(() => errorResponse(404));
  app.onError(() => errorResponse(503));

  return app;
}
