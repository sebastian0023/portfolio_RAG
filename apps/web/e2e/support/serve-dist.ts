// Serves the production build with the same security headers CloudFront sends, so browser tests of the real
// bundle run under the real Content-Security-Policy. The header source of truth is
// infra/modules/edge/security-headers.json. Like CloudFront with a private bucket, unknown paths are plain 404s
// (there is no SPA fallback), and nothing answers /api/*: tests route those requests themselves.
// Usage: node e2e/support/serve-dist.ts <port>
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../dist/web/browser');
const headersFile = resolve(
  here,
  '../../../../infra/modules/edge/security-headers.json',
);
const spaHeaders = (
  JSON.parse(readFileSync(headersFile, 'utf8')) as {
    spa: Record<string, string>;
  }
).spa;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const port = Number(process.argv[2] ?? 4300);

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = normalize(join(root, path));
  let body: Buffer | undefined;
  if (file.startsWith(root) && !path.startsWith('/api/')) {
    try {
      body = readFileSync(file);
    } catch {
      body = undefined;
    }
  }
  if (body === undefined) {
    response.writeHead(404, { 'content-type': 'text/plain', ...spaHeaders });
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    ...spaHeaders,
  });
  response.end(body);
}).listen(port, '127.0.0.1');
