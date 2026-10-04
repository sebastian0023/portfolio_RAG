import { createHash } from 'node:crypto';

// Streaming echo for the CloudFront OAC spike (P1-10, R-04). It reports facts about the request
// but never logs or returns header values or the body: the auth token must stay out of logs.
export const handler = awslambda.streamifyResponse(
  async (event, responseStream) => {
    const headers = event.headers ?? {};
    const body = Buffer.from(
      event.body ?? '',
      event.isBase64Encoded ? 'base64' : 'utf8',
    );
    const token = headers['x-auth-token'];
    const facts = {
      method: event.requestContext?.http?.method,
      bodyBytes: body.length,
      tokenHeaderPresent: typeof token === 'string' && token.length > 0,
      tokenLength: typeof token === 'string' ? token.length : 0,
      authorizationIsSigV4: /^AWS4-HMAC-SHA256 /.test(
        headers['authorization'] ?? '',
      ),
      hashHeaderMatchesBody:
        headers['x-amz-content-sha256'] ===
        createHash('sha256').update(body).digest('hex'),
    };

    const stream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
      },
    });
    for (let chunk = 1; chunk <= 5; chunk += 1) {
      const payload = chunk === 1 ? { chunk, ...facts } : { chunk };
      stream.write(`data: ${JSON.stringify(payload)}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    stream.end();
  },
);
