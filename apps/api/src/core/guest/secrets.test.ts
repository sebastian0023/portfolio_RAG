import { describe, expect, test } from 'vitest';
import { CachedSecrets, parseSecrets, type SecretSource } from './secrets.js';

const GOOD = {
  turnstile_secret: 'turnstile-secret-value',
  guest_pass_key: 'k'.repeat(40),
};

describe('secrets (ADR-052, R-18)', () => {
  test('accepts a real secret and a long enough key', () => {
    expect(parseSecrets(GOOD)).toEqual({
      status: 'ready',
      secrets: {
        turnstileSecret: GOOD.turnstile_secret,
        guestPassKey: GOOD.guest_pass_key,
      },
    });
  });

  test.each([
    ['missing turnstile secret', { guest_pass_key: GOOD.guest_pass_key }],
    ['missing key', { turnstile_secret: GOOD.turnstile_secret }],
    ['placeholder turnstile secret', { ...GOOD, turnstile_secret: 'unset' }],
    ['placeholder key', { ...GOOD, guest_pass_key: 'unset' }],
    ['key under 32 characters', { ...GOOD, guest_pass_key: 'short' }],
    ['empty values', { turnstile_secret: '', guest_pass_key: '' }],
    ['nothing', {}],
  ])('is unavailable with %s', (_name, raw) => {
    expect(parseSecrets(raw)).toEqual({ status: 'unavailable' });
  });

  test('never carries a value on the unavailable state', () => {
    expect(JSON.stringify(parseSecrets({ turnstile_secret: 'unset' }))).toBe(
      '{"status":"unavailable"}',
    );
  });
});

describe('CachedSecrets', () => {
  const source = (
    loads: () => Promise<Record<string, string>>,
  ): SecretSource => ({ load: loads });

  test('caches a good result and shares one concurrent refresh', async () => {
    let calls = 0;
    let now = 0;
    const cache = new CachedSecrets(
      source(() => {
        calls += 1;
        return Promise.resolve(GOOD);
      }),
      { now: () => now },
    );
    await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(calls).toBe(1);
    now = 299_000;
    await cache.get();
    expect(calls).toBe(1);
    now = 301_000;
    await cache.get();
    expect(calls).toBe(2);
  });

  test('a failure is remembered briefly and never reuses an older good value', async () => {
    let fail = false;
    let calls = 0;
    let now = 0;
    const cache = new CachedSecrets(
      source(() => {
        calls += 1;
        return fail
          ? Promise.reject(new Error('ssm down'))
          : Promise.resolve(GOOD);
      }),
      { now: () => now },
    );
    expect((await cache.get()).status).toBe('ready');
    fail = true;
    now = 301_000;
    expect((await cache.get()).status).toBe('unavailable');
    now = 303_000;
    await cache.get();
    expect(calls).toBe(2);
    now = 307_000;
    await cache.get();
    expect(calls).toBe(3);
  });

  test('recovers after the failure window when SSM returns', async () => {
    let fail = true;
    let now = 0;
    const cache = new CachedSecrets(
      source(() =>
        fail ? Promise.reject(new Error('x')) : Promise.resolve(GOOD),
      ),
      { now: () => now },
    );
    expect((await cache.get()).status).toBe('unavailable');
    fail = false;
    now = 6_000;
    expect((await cache.get()).status).toBe('ready');
  });
});
