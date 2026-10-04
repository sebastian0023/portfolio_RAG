// Loads the built Lambda bundle on whatever Node is running and sends it one request that is refused before
// any AWS call. CI runs this under Node 24, the Lambda runtime, because local checks run on Node 26.
// Usage: node apps/api/scripts/load-bundle.mjs (after `npm run build -w @portfolio/api`)
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

const bundle = resolve(import.meta.dirname, '../dist/lambda/index.mjs');

process.env.APP_ENV = 'production';
process.env.PARAMETER_PREFIX = '/portfolio-v2/prod';
process.env.COUNTERS_TABLE = 'portfolio-v2-prod-counters';
process.env.AWS_REGION = 'us-east-1';

let status;
let body = '';
globalThis.awslambda = {
  streamifyResponse: (handler) => handler,
  HttpResponseStream: {
    from: (stream, metadata) => {
      status = metadata.statusCode;
      return stream;
    },
  },
};

const { handler } = await import(pathToFileURL(bundle).href);
await handler(
  {
    rawPath: '/api/chat',
    headers: { host: 'example.test', 'content-type': 'text/plain' },
    requestContext: { http: { method: 'POST' } },
    body: 'hi',
  },
  {
    write: (chunk) => {
      body += new TextDecoder().decode(chunk);
      return true;
    },
    end: () => undefined,
    on() {
      return this;
    },
  },
);

if (status !== 415 || !body.includes('"code":"unavailable"')) {
  process.stderr.write(
    `bundle did not behave on ${process.version}: status ${status}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `bundle loads and refuses a bad request on ${process.version}\n`,
);
