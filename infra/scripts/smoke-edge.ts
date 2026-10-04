// Post-deploy smoke test through CloudFront (operator-run). Usage:
//   node infra/scripts/smoke-edge.ts            edge, refusals, and the race, with chat OFF (costs nothing)
//   node infra/scripts/smoke-edge.ts --with-chat   also streams one real answer; set chat_enabled=true first
// It reads targets from `terraform output`, prints PASS or FAIL per case with timings, and never prints a
// request body, a response body, a token, or an address (ADR-028). The race case spends the whole per-IP
// minute budget, so it waits for a fresh minute first; the one chat message costs under a cent.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const withChat = process.argv.includes('--with-chat');

const outputs = JSON.parse(
  execFileSync('terraform', ['-chdir=infra/stack', 'output', '-json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }),
) as Record<string, { value: string } | undefined>;
const out = (name: string): string => {
  const value = outputs[name]?.value;
  if (!value) throw new Error(`terraform output ${name} is missing`);
  return value;
};
const site = out('site_url');
const directUrl = out('api_function_url');
const bucket = out('web_bucket');

const expected = (
  JSON.parse(
    readFileSync(
      resolve(repoRoot, 'infra/modules/edge/security-headers.json'),
      'utf8',
    ),
  ) as {
    spa: Record<string, string>;
  }
).spa;

const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');
const frames = (text: string): unknown[] =>
  text
    .split('\n\n')
    .filter((f) => f.startsWith('data: '))
    .map((f) => JSON.parse(f.slice(6)) as unknown);

let failures = 0;
function report(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  process.stdout.write(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`,
  );
}

async function chat(
  body: string,
  headers: Record<string, string> = {},
  hash = sha256(body),
): Promise<Response> {
  return fetch(`${site}/api/chat`, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-amz-content-sha256': hash,
      ...headers,
    },
  });
}
const question = (text: string): string =>
  JSON.stringify({ question: text, history: [] });
const errorCode = async (response: Response): Promise<unknown> => {
  const first = frames(await response.text())[0] as
    { error?: { code?: string } } | undefined;
  return first?.error?.code;
};

// 1. The SPA and its headers.
const home = await fetch(`${site}/`);
const html = await home.text();
report(
  'GET / returns the SPA',
  home.status === 200 && html.includes('<app-root'),
);
for (const [name, value] of Object.entries(expected)) {
  report(`header ${name}`, home.headers.get(name) === value);
}
report(
  'index.html has no inline script',
  !/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html),
);
report(
  'index.html is not cached',
  (home.headers.get('cache-control') ?? '').includes('no-cache'),
);
const asset = /src="([^"]+\.js)"/.exec(html)?.[1];
if (asset) {
  const response = await fetch(`${site}/${asset}`);
  report(
    'hashed asset is immutable',
    (response.headers.get('cache-control') ?? '').includes('immutable'),
  );
}
const version = (await (await fetch(`${site}/version.json`)).json()) as {
  sha?: string;
};
report(
  'version.json names the deployed commit',
  typeof version.sha === 'string' && version.sha.length >= 7,
  version.sha,
);

// 2. Private origins refuse direct access.
const direct = await fetch(
  `https://${bucket}.s3.us-east-1.amazonaws.com/index.html`,
);
report('direct S3 object is refused', direct.status === 403);
const unsigned = await fetch(directUrl.replace(/\/$/, '') + '/api/chat', {
  method: 'POST',
  body: question('hi'),
  headers: { 'content-type': 'application/json' },
});
report('unsigned call to the Function URL is refused', unsigned.status === 403);

// 3. The edge requires the body hash.
report(
  'POST without a hash is refused',
  (
    await fetch(`${site}/api/chat`, {
      method: 'POST',
      body: question('hi'),
      headers: { 'content-type': 'application/json' },
    })
  ).status === 403,
);
report(
  'POST with a wrong hash is refused',
  (await chat(question('hi'), {}, sha256('other'))).status === 403,
);

// 4. API routing never falls back to the SPA.
const missing = await fetch(`${site}/api/nope`);
report(
  'unknown API path is a 404 SSE error, not HTML',
  missing.status === 404 &&
    (missing.headers.get('content-type') ?? '').includes('text/event-stream'),
);
const options = await fetch(`${site}/api/chat`, {
  method: 'OPTIONS',
  headers: {
    origin: 'https://evil.example',
    'access-control-request-method': 'POST',
  },
});
report(
  'OPTIONS is refused without CORS headers',
  options.status === 405 &&
    ![...options.headers.keys()].some((k) => k.startsWith('access-control-')),
  String(options.status),
);

// 5. Validation refuses before anything is reserved or spent.
const big = await chat(
  JSON.stringify({ question: 'x', history: [], pad: 'p'.repeat(9000) }),
);
report('9 KB body is refused with 413', big.status === 413, String(big.status));
const huge = await chat(
  JSON.stringify({ question: 'x', history: [], pad: 'p'.repeat(1_000_000) }),
);
report(
  '1 MB body is refused with 413',
  huge.status === 413,
  String(huge.status),
);
const tooLong = await chat(question('q'.repeat(501)));
report(
  '501-character question is too_long',
  tooLong.status === 400 && (await errorCode(tooLong)) === 'too_long',
);
const wrongType = await fetch(`${site}/api/chat`, {
  method: 'POST',
  body: 'hi',
  headers: {
    'content-type': 'text/plain',
    'x-amz-content-sha256': sha256('hi'),
  },
});
report(
  'wrong content type is refused with 415',
  wrongType.status === 415,
  String(wrongType.status),
);

// 6. The per-minute limit under concurrency. Start at the top of a minute so the whole budget is available.
const wait = 60_000 - (Date.now() % 60_000) + 1500;
process.stdout.write(
  `      waiting ${Math.round(wait / 1000)} s for a fresh minute window\n`,
);
await new Promise((resolveWait) => setTimeout(resolveWait, wait));
// Reserved concurrency is 5 (ADR-024), so a larger burst is refused by Lambda itself with a bare 429 before
// this API sees it. Stay under that: four at once, then sequential requests, to count the per-IP limit of 10.
const probe = (): Promise<Response> => chat(question('rate probe'));
const wave = await Promise.all(Array.from({ length: 4 }, probe));
const rest: Response[] = [];
for (let i = 0; i < 6; i += 1) rest.push(await probe());
const firstTen = [...wave, ...rest];
report(
  'the first 10 requests in the window are all admitted (4 concurrent, then 6 in a row)',
  firstTen.every((r) => r.status !== 429),
  firstTen.map((r) => r.status).join(','),
);
const eleventh = await probe();
const twelfth = await probe();
report(
  'the 11th and 12th request are rate limited with Retry-After',
  eleventh.status === 429 &&
    twelfth.status === 429 &&
    Number(eleventh.headers.get('retry-after')) >= 1,
  `${eleventh.status}, ${twelfth.status}, retry-after ${String(eleventh.headers.get('retry-after'))}`,
);
report(
  'the refusal is an SSE rate_limited event',
  (eleventh.headers.get('content-type') ?? '').includes('text/event-stream') &&
    (await errorCode(eleventh)) === 'rate_limited',
);
if (!withChat) {
  report(
    'with chat off every admitted request is a 503 unavailable',
    firstTen.every((r) => r.status === 503),
  );
}
// A burst beyond reserved concurrency gets Lambda's own bare 429 (no SSE body, no Retry-After). The browser
// maps that to rate_limited with a 10 second retry (ADR-049); this just records that it is observed.
const over = await Promise.all(Array.from({ length: 12 }, probe));
const bare = over.filter(
  (r) =>
    r.status === 429 &&
    !(r.headers.get('content-type') ?? '').includes('text/event-stream'),
).length;
process.stdout.write(
  `      info: ${bare} of 12 burst requests got Lambda's bare 429\n`,
);

// 7. One real streamed answer (chat must be on, and a fresh minute is needed again).
if (withChat) {
  const again = 60_000 - (Date.now() % 60_000) + 1500;
  process.stdout.write(
    `      waiting ${Math.round(again / 1000)} s for the next minute window\n`,
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, again));
  const started = performance.now();
  const response = await chat(question('In one sentence, what is TypeScript?'));
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let firstByteMs = 0;
  let firstDeltaMs = 0;
  for (;;) {
    const { done, value } = reader
      ? await reader.read()
      : { done: true, value: undefined };
    if (done) break;
    firstByteMs ||= performance.now() - started;
    text += decoder.decode(value, { stream: true });
    if (!firstDeltaMs && text.includes('"type":"delta"'))
      firstDeltaMs = performance.now() - started;
  }
  const totalMs = performance.now() - started;
  const events = frames(text) as { type?: string; coverage?: string }[];
  const kinds = events.map((e) => e.type);
  report(
    'answer is a 200 SSE stream',
    response.status === 200 &&
      (response.headers.get('content-type') ?? '').includes(
        'text/event-stream',
      ),
  );
  report('first event is accepted', kinds[0] === 'accepted');
  report(
    'answer streams deltas and ends with done (no coverage)',
    kinds.includes('delta') &&
      kinds.at(-1) === 'done' &&
      events.at(-1)?.coverage === 'none',
  );
  report(
    'the stream is incremental, not buffered',
    firstDeltaMs > 0 && firstDeltaMs < totalMs - 100,
    `first byte ${Math.round(firstByteMs)} ms, first delta ${Math.round(firstDeltaMs)} ms, total ${Math.round(totalMs)} ms`,
  );
}

process.stdout.write(
  `\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
