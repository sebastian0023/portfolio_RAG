import { describe, expect, test } from 'vitest';
import {
  byteCapStage,
  configStage,
  contentTypeStage,
} from '../chat/admission.js';
import {
  chatEnabledStage,
  preAuthRateStage,
  trustedIpStage,
} from '../admission/stages.js';
import { fingerprint } from '../admission/windows.js';
import {
  configFrom,
  context,
  memoryLogger,
  rawConfig,
} from '../../testing/helpers.js';
import { InMemoryCounterStore } from '../../testing/in-memory-counter-store.js';
import {
  createGuestPassHandler,
  guestTokenStage,
} from './guest-pass-handler.js';
import { verifyPass } from './guest-pass.js';
import { CachedSecrets } from './secrets.js';
import type { TurnstileCheck, TurnstileOutcome } from './turnstile-port.js';

const NOW = Date.parse('2026-10-04T12:34:30Z');
const KEY = 'k'.repeat(48);

function setup(
  options: {
    outcome?: TurnstileOutcome;
    secretsGood?: boolean;
    raw?: Record<string, string>;
    store?: InMemoryCounterStore;
  } = {},
) {
  const logger = memoryLogger();
  const checks: TurnstileCheck[] = [];
  const store = options.store ?? new InMemoryCounterStore();
  const handler = createGuestPassHandler({
    stages: [
      contentTypeStage,
      byteCapStage,
      guestTokenStage,
      configStage(configFrom(options.raw ?? rawConfig())),
      trustedIpStage,
      preAuthRateStage(store, () => NOW),
      chatEnabledStage,
    ],
    secrets: new CachedSecrets({
      load: () =>
        Promise.resolve(
          options.secretsGood === false
            ? { turnstile_secret: 'unset', guest_pass_key: 'unset' }
            : { turnstile_secret: 'turnstile-secret', guest_pass_key: KEY },
        ),
    }),
    verifier: {
      verify: (check) => {
        checks.push(check);
        return Promise.resolve(options.outcome ?? 'passed');
      },
    },
    logger,
    now: () => NOW,
  });
  return { handler, logger, checks, store };
}

const ctx = (json: unknown, address = '203.0.113.9:4444') =>
  context({
    json,
    headers: new Headers({ 'cloudfront-viewer-address': address }),
  });

describe('guest pass handler (ADR-052)', () => {
  test('a passed check returns a pass bound to the visitor and valid for an hour', async () => {
    const { handler, checks } = setup();
    const response = await handler(ctx({ token: 'tok' }), 'req-1');
    expect(response.status).toBe(200);
    if (!('pass' in response.body)) throw new Error('expected a pass');
    expect(
      verifyPass(KEY, response.body.pass, fingerprint('v4:203.0.113.9'), NOW),
    ).toBe('valid');
    expect(response.body.expiresAt).toBe(NOW / 1000 + 3600);
    expect(checks[0]).toEqual({
      secret: 'turnstile-secret',
      token: 'tok',
      remoteIp: '203.0.113.9',
      idempotencyKey: 'req-1',
    });
  });

  test('a refused token is 403 guest_check_failed and issues nothing', async () => {
    const { handler } = setup({ outcome: 'failed' });
    expect(await handler(ctx({ token: 'bad' }), 'r')).toEqual({
      status: 403,
      body: { error: 'guest_check_failed' },
    });
  });

  test('an unavailable check is 503 and issues nothing (fail closed)', async () => {
    const { handler } = setup({ outcome: 'unavailable' });
    expect(await handler(ctx({ token: 'x' }), 'r')).toEqual({
      status: 503,
      body: { error: 'unavailable' },
    });
  });

  test.each([
    [{}],
    [{ token: '' }],
    [{ token: 1 }],
    [{ token: 'a', extra: 1 }],
    [{ token: 'x'.repeat(2049) }],
  ])('a bad body %j is a 400 and never calls Cloudflare', async (json) => {
    const { handler, checks } = setup();
    const response = await handler(ctx(json), 'r');
    expect(response.status).toBe(400);
    expect(checks).toHaveLength(0);
  });

  test('a token of exactly 2048 characters is accepted', async () => {
    const { handler, checks } = setup();
    expect((await handler(ctx({ token: 'x'.repeat(2048) }), 'r')).status).toBe(
      200,
    );
    expect(checks).toHaveLength(1);
  });

  test('a wrong content type is 415 and never calls Cloudflare', async () => {
    const { handler, checks } = setup();
    const response = await handler(
      context({ contentType: 'text/plain', headers: new Headers() }),
      'r',
    );
    expect(response.status).toBe(415);
    expect(checks).toHaveLength(0);
  });

  test('chat off refuses before Cloudflare is called', async () => {
    const { handler, checks } = setup({
      raw: rawConfig({ chat_enabled: 'false' }),
    });
    expect((await handler(ctx({ token: 't' }), 'r')).status).toBe(503);
    expect(checks).toHaveLength(0);
  });

  test('the per-minute limit bounds how often Cloudflare is called, with Retry-After', async () => {
    const { handler, checks } = setup();
    for (let i = 0; i < 10; i += 1) await handler(ctx({ token: 't' }), `r${i}`);
    const response = await handler(ctx({ token: 't' }), 'r11');
    expect(response).toMatchObject({
      status: 429,
      retryAfterSeconds: 30,
      body: { error: 'rate_limited' },
    });
    expect(checks).toHaveLength(10);
  });

  test('a missing or ambiguous viewer address refuses before Cloudflare is called', async () => {
    const { handler, checks } = setup();
    const response = await handler(
      context({ json: { token: 't' }, headers: new Headers() }),
      'r',
    );
    expect(response.status).toBe(503);
    expect(checks).toHaveLength(0);
  });

  test('unset or unreadable secrets refuse with 503 and never reach Cloudflare', async () => {
    const { handler, checks } = setup({ secretsGood: false });
    expect(await handler(ctx({ token: 't' }), 'r')).toEqual({
      status: 503,
      body: { error: 'unavailable' },
    });
    expect(checks).toHaveLength(0);
  });

  test('logs metadata only: never the token, the pass, or the address', async () => {
    const { handler, logger } = setup();
    await handler(ctx({ token: 'CANARY-TOKEN-1' }, '203.0.113.9:4444'), 'req');
    const text = JSON.stringify(logger.events);
    for (const canary of ['CANARY-TOKEN-1', '203.0.113.9', 'v1.'])
      expect(text).not.toContain(canary);
    expect(logger.events.at(-1)).toMatchObject({
      stage: 'guest_pass',
      outcome: 'completed',
      status: 200,
    });
  });
});
