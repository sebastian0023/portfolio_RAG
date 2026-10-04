import { describe, expect, test } from 'vitest';
import {
  createSiteverifyClient,
  SITEVERIFY_URL,
  type FetchLike,
} from './siteverify-client.js';

const CHECK = {
  secret: 'the-secret',
  token: 'the-token',
  remoteIp: '203.0.113.9',
  idempotencyKey: 'req-1',
};

const answer =
  (body: unknown, ok = true): FetchLike =>
  () =>
    Promise.resolve({ ok, json: () => Promise.resolve(body) });

describe('Turnstile siteverify client (ADR-052)', () => {
  test('posts the secret, token, viewer IP, and idempotency key as JSON to Cloudflare', async () => {
    let seen:
      | { url: string; body: unknown; method: string; signal: AbortSignal }
      | undefined;
    const verifier = createSiteverifyClient((url, init) => {
      seen = {
        url,
        body: JSON.parse(init.body),
        method: init.method,
        signal: init.signal,
      };
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, action: 'chat' }),
      });
    });
    await verifier.verify(CHECK);
    expect(seen?.url).toBe(SITEVERIFY_URL);
    expect(seen?.method).toBe('POST');
    expect(seen?.body).toEqual({
      secret: 'the-secret',
      response: 'the-token',
      remoteip: '203.0.113.9',
      idempotency_key: 'req-1',
    });
    expect(seen?.signal.aborted).toBe(false);
  });

  test('a successful check for the chat action passes', async () => {
    expect(
      await createSiteverifyClient(
        answer({ success: true, action: 'chat', hostname: 'x' }),
      ).verify(CHECK),
    ).toBe('passed');
  });

  test('a success for another action or no action does not pass', async () => {
    expect(
      await createSiteverifyClient(
        answer({ success: true, action: 'login' }),
      ).verify(CHECK),
    ).toBe('failed');
    expect(
      await createSiteverifyClient(answer({ success: true })).verify(CHECK),
    ).toBe('failed');
  });

  test.each([
    ['timeout-or-duplicate'],
    ['invalid-input-response'],
    ['missing-input-response'],
  ])('a refused token (%s) is failed', async (code) => {
    expect(
      await createSiteverifyClient(
        answer({ success: false, 'error-codes': [code] }),
      ).verify(CHECK),
    ).toBe('failed');
  });

  test.each([
    ['invalid-input-secret'],
    ['missing-input-secret'],
    ['internal-error'],
    ['bad-request'],
  ])(
    'a platform error (%s) is unavailable, not a failed visitor',
    async (code) => {
      expect(
        await createSiteverifyClient(
          answer({ success: false, 'error-codes': [code] }),
        ).verify(CHECK),
      ).toBe('unavailable');
    },
  );

  test('an HTTP error, a malformed answer, a thrown fetch, and a timeout are all unavailable', async () => {
    expect(
      await createSiteverifyClient(
        answer({ success: true, action: 'chat' }, false),
      ).verify(CHECK),
    ).toBe('unavailable');
    expect(
      await createSiteverifyClient(answer({ nope: 1 })).verify(CHECK),
    ).toBe('unavailable');
    expect(
      await createSiteverifyClient(answer('not an object')).verify(CHECK),
    ).toBe('unavailable');
    expect(
      await createSiteverifyClient(() =>
        Promise.reject(new TypeError('offline')),
      ).verify(CHECK),
    ).toBe('unavailable');
    const timeout = createSiteverifyClient(() =>
      Promise.reject(new DOMException('timed out', 'TimeoutError')),
    );
    expect(await timeout.verify(CHECK)).toBe('unavailable');
  });

  test('never echoes the secret or the token in what it returns', async () => {
    const result = await createSiteverifyClient(
      answer({ success: false, 'error-codes': ['invalid-input-response'] }),
    ).verify(CHECK);
    expect(JSON.stringify(result)).not.toContain('the-secret');
    expect(JSON.stringify(result)).not.toContain('the-token');
  });
});
