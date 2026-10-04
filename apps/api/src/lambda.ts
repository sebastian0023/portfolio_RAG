// Composition root of the API (ADR-043). This stub is fail closed: every request is refused with one
// SSE error event until the chat pipeline is wired in P3-03 to P3-05. It is deployable on its own so the
// edge, alias, and IAM wiring can be verified before any model call exists.
const UNAVAILABLE_FRAME =
  'data: {"type":"error","error":{"code":"unavailable"}}\n\n';

export const handler = awslambda.streamifyResponse(
  async (_event, responseStream) => {
    const stream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 503,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
    stream.write(UNAVAILABLE_FRAME);
    stream.end();
  },
);
