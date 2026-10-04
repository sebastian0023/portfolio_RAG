import {
  CHAT_API_PATH,
  MAX_REQUEST_BYTES,
  createSseDecoder,
  type ChatRequest,
  type ChatStreamEvent,
} from '@portfolio/shared';
import { chatStreamEventSchema } from '@portfolio/shared/chat-stream-schema';
import {
  NetworkError,
  type ChatTransport,
} from '../../core/ports/chat-transport';
import { fitRequest } from './request-fit';
import { sha256Hex } from './sha256';

// The API answered with something that is not a valid event. Not a connection problem, so it is not a
// NetworkError: the facade shows the answer as interrupted.
export class ProtocolError extends Error {
  override readonly name = 'ProtocolError';
}

// The Lambda reserved-concurrency throttle answers 429 with no SSE body (ADR-049).
const THROTTLE_RETRY_SECONDS = 10;

const isAbort = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  (error as { name: unknown }).name === 'AbortError';

// Streams the chat answer over fetch (EventSource cannot POST). Every event is validated with the shared
// schema before the facade sees it (ADR-048, ADR-044).
export class HttpChatTransport implements ChatTransport {
  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  send(
    request: ChatRequest,
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamEvent> {
    return this.run(request, signal);
  }

  private async *run(
    request: ChatRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const { bytes } = fitRequest(request, MAX_REQUEST_BYTES);
    const hash = await sha256Hex(bytes);

    let response: Response;
    try {
      response = await this.fetchImpl(CHAT_API_PATH, {
        method: 'POST',
        body: bytes,
        headers: {
          'content-type': 'application/json',
          'x-amz-content-sha256': hash,
          accept: 'text/event-stream',
        },
        signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      });
    } catch (error) {
      // The facade ignores an abort; anything else means the request never reached the server.
      if (isAbort(error)) throw error;
      throw new NetworkError('The request could not be sent.');
    }

    const isStream = (response.headers.get('content-type') ?? '').includes(
      'text/event-stream',
    );
    if (!isStream) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 429) {
        yield {
          type: 'error',
          error: {
            code: 'rate_limited',
            retryAfterSeconds: THROTTLE_RETRY_SECONDS,
          },
        };
        return;
      }
      // CloudFront 403/502/504, a Lambda init failure, or a proxy page: the API never answered.
      throw new NetworkError('The assistant could not be reached.');
    }
    if (!response.body) throw new NetworkError('The response had no body.');

    const reader = response.body.getReader();
    const text = new TextDecoder('utf-8');
    const sse = createSseDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        let payloads: string[];
        try {
          payloads = sse.push(text.decode(value, { stream: true }));
        } catch {
          throw new ProtocolError('The stream was malformed.');
        }
        for (const payload of payloads) {
          let json: unknown;
          try {
            json = JSON.parse(payload) as unknown;
          } catch {
            throw new ProtocolError('The stream carried invalid JSON.');
          }
          const parsed = chatStreamEventSchema.safeParse(json);
          if (!parsed.success)
            throw new ProtocolError('The stream carried an unknown event.');
          yield parsed.data;
        }
      }
    } finally {
      // Stops the download when the facade abandons the stream or a frame was invalid.
      await reader.cancel().catch(() => undefined);
    }
  }
}
