import { z } from 'zod';
import type { Logger } from '../../core/ports/logger.js';
import { errorResponse } from '../http/sse-response.js';

// Lambda Function URL payload (format 2.0). Only the fields this adapter reads are declared.
const functionUrlEventSchema = z.looseObject({
  rawPath: z.string(),
  rawQueryString: z.string().optional(),
  headers: z.record(z.string(), z.string()),
  requestContext: z.looseObject({
    http: z.looseObject({ method: z.string() }),
  }),
  body: z.string().optional(),
  isBase64Encoded: z.boolean().optional(),
});

export interface HttpResponseStreamApi {
  from(
    responseStream: LambdaResponseStream,
    metadata: { statusCode: number; headers?: Record<string, string> },
  ): LambdaResponseStream;
}

export interface StreamHandlerDeps {
  readonly app: { fetch(request: Request): Response | Promise<Response> };
  readonly httpResponseStream: HttpResponseStreamApi;
  readonly logger: Logger;
  readonly newRequestId: () => string;
}

// Adapts the Function URL event to a web Request and streams the Response back (ADR-004). Hono's own Lambda
// helper is not used: it attaches no AbortSignal and logs raw errors, which ADR-028 forbids.
export function createStreamHandler(deps: StreamHandlerDeps) {
  return async (
    rawEvent: unknown,
    responseStream: LambdaResponseStream,
  ): Promise<void> => {
    const controller = new AbortController();
    // A closed or errored response stream means the viewer disconnected: stop the model call.
    responseStream.on('close', () => controller.abort());
    responseStream.on('error', () => controller.abort());

    let response: Response;
    const parsed = functionUrlEventSchema.safeParse(rawEvent);
    if (!parsed.success) {
      response = errorResponse(400);
    } else {
      const event = parsed.data;
      const method = event.requestContext.http.method.toUpperCase();
      const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
      const host = event.headers['host'] ?? 'localhost';
      try {
        const body =
          method === 'GET' || method === 'HEAD' || event.body === undefined
            ? undefined
            : event.isBase64Encoded
              ? Buffer.from(event.body, 'base64')
              : Buffer.from(event.body, 'utf8');
        response = await deps.app.fetch(
          new Request(`https://${host}${event.rawPath}${query}`, {
            method,
            headers: event.headers,
            ...(body === undefined ? {} : { body }),
            signal: controller.signal,
          }),
        );
      } catch {
        deps.logger.log({
          requestId: deps.newRequestId(),
          stage: 'transport',
          outcome: 'failed',
          status: 503,
        });
        response = errorResponse(503);
      }
    }

    const out = deps.httpResponseStream.from(responseStream, {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers),
    });
    const reader = response.body?.getReader();
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        out.write(value);
      }
    } catch {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
    } finally {
      out.end();
    }
  };
}
