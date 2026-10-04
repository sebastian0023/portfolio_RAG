import { describe, expect, test } from 'vitest';
import {
  byteCapStage,
  configStage,
  contentTypeStage,
  providerStage,
  runAdmission,
  schemaStage,
  type AdmissionStage,
} from '../chat/admission.js';
import { issuePass } from '../guest/guest-pass.js';
import { CachedSecrets } from '../guest/secrets.js';
import { ProviderRegistry } from '../llm/provider-registry.js';
import { fakeProvider } from '../../testing/fake-llm-provider.js';
import { configFrom, context, rawConfig } from '../../testing/helpers.js';
import { InMemoryCounterStore } from '../../testing/in-memory-counter-store.js';
import {
  chatEnabledStage,
  guestPassStage,
  guestQuotaStage,
  preAuthRateStage,
  trustedIpStage,
} from './stages.js';
import { fingerprint } from './windows.js';

const NOW = Date.parse('2026-10-04T12:34:30Z');
const KEY = 'k'.repeat(48);
const VIEWER = '203.0.113.9:4444';
const BUCKET = fingerprint('v4:203.0.113.9');

const secrets = (good = true) =>
  new CachedSecrets({
    load: () =>
      good
        ? Promise.resolve({
            turnstile_secret: 'turnstile-secret',
            guest_pass_key: KEY,
          })
        : Promise.resolve({
            turnstile_secret: 'unset',
            guest_pass_key: 'unset',
          }),
  });

function chain(
  store: InMemoryCounterStore,
  options: { secrets?: CachedSecrets; raw?: Record<string, string> } = {},
) {
  const calls: string[] = [];
  const spy =
    (name: string, stage: AdmissionStage): AdmissionStage =>
    async (ctx) => {
      calls.push(name);
      return stage(ctx);
    };
  const registry = new ProviderRegistry().register(
    'bedrock-runtime',
    () => fakeProvider({ kind: 'text', chunks: [] }).provider,
  );
  return {
    calls,
    stages: [
      spy('contentType', contentTypeStage),
      spy('byteCap', byteCapStage),
      spy('schema', schemaStage),
      spy('config', configStage(configFrom(options.raw ?? rawConfig()))),
      spy('trustedIp', trustedIpStage),
      spy(
        'rate',
        preAuthRateStage(store, () => NOW),
      ),
      spy('chatEnabled', chatEnabledStage),
      spy(
        'guestPass',
        guestPassStage(options.secrets ?? secrets(), () => NOW),
      ),
      spy('provider', providerStage(registry)),
      spy(
        'guestQuota',
        guestQuotaStage(store, () => NOW),
      ),
    ],
  };
}

const request = (token: string | null, address = VIEWER) => {
  const headers = new Headers({ 'cloudfront-viewer-address': address });
  if (token !== null) headers.set('x-auth-token', token);
  return context({ headers });
};

describe('guest pass stage (ADR-052)', () => {
  test('a valid pass is admitted through the whole chain', async () => {
    const { pass } = issuePass(KEY, BUCKET, NOW);
    const ctx = request(pass);
    expect(
      await runAdmission(chain(new InMemoryCounterStore()).stages, ctx),
    ).toBeUndefined();
    expect(ctx.quota).toEqual({ left: 9, limit: 10 });
  });

  test('runs after chat_enabled and before the provider and the quota', async () => {
    const { pass } = issuePass(KEY, BUCKET, NOW);
    const { stages, calls } = chain(new InMemoryCounterStore());
    await runAdmission(stages, request(pass));
    expect(calls.slice(-4)).toEqual([
      'chatEnabled',
      'guestPass',
      'provider',
      'guestQuota',
    ]);
  });

  test.each([
    ['no pass', null],
    ['garbage', 'garbage'],
    ['an Authorization-style token', 'Bearer abc.def.ghi'],
  ])(
    '%s is guest_check_failed (403) and nothing is reserved for the quota',
    async (_name, token) => {
      const store = new InMemoryCounterStore();
      const { stages, calls } = chain(store);
      expect(await runAdmission(stages, request(token))).toMatchObject({
        code: 'guest_check_failed',
        status: 403,
      });
      expect(calls).not.toContain('provider');
      expect(calls).not.toContain('guestQuota');
      expect([...store.counts.keys()].some((k) => k.startsWith('quota#'))).toBe(
        false,
      );
    },
  );

  test('an expired pass asks for the check again', async () => {
    const { pass } = issuePass(KEY, BUCKET, NOW - 3601_000);
    expect(
      await runAdmission(
        chain(new InMemoryCounterStore()).stages,
        request(pass),
      ),
    ).toMatchObject({
      code: 'guest_check_failed',
    });
  });

  test('a pass from another network, or signed with another key, is refused', async () => {
    const other = issuePass(KEY, fingerprint('v4:198.51.100.7'), NOW).pass;
    expect(
      await runAdmission(
        chain(new InMemoryCounterStore()).stages,
        request(other),
      ),
    ).toMatchObject({ code: 'guest_check_failed' });
    const forged = issuePass('z'.repeat(48), BUCKET, NOW).pass;
    expect(
      await runAdmission(
        chain(new InMemoryCounterStore()).stages,
        request(forged),
      ),
    ).toMatchObject({ code: 'guest_check_failed' });
  });

  test('the pass follows the visitor within an IPv6 /64 but not to another /64', async () => {
    const bucket = fingerprint('v6:2001:db8:1:1');
    const { pass } = issuePass(KEY, bucket, NOW);
    expect(
      await runAdmission(
        chain(new InMemoryCounterStore()).stages,
        request(pass, '2001:db8:1:1:aaaa::5:5000'),
      ),
    ).toBeUndefined();
    expect(
      await runAdmission(
        chain(new InMemoryCounterStore()).stages,
        request(pass, '2001:db8:1:2::5:5000'),
      ),
    ).toMatchObject({ code: 'guest_check_failed' });
  });

  test('unreadable or placeholder secrets refuse with 503, never let a request through', async () => {
    const { pass } = issuePass(KEY, BUCKET, NOW);
    const result = await runAdmission(
      chain(new InMemoryCounterStore(), { secrets: secrets(false) }).stages,
      request(pass),
    );
    expect(result).toMatchObject({ code: 'unavailable', status: 503 });
  });

  test('a spoofed X-Forwarded-For cannot borrow another visitor pass', async () => {
    const victim = issuePass(KEY, fingerprint('v4:198.51.100.7'), NOW).pass;
    const headers = new Headers({
      'cloudfront-viewer-address': VIEWER,
      'x-forwarded-for': '198.51.100.7',
      'x-auth-token': victim,
    });
    expect(
      await runAdmission(
        chain(new InMemoryCounterStore()).stages,
        context({ headers }),
      ),
    ).toMatchObject({ code: 'guest_check_failed' });
  });

  test('chat off refuses before the pass is even looked at', async () => {
    const { stages, calls } = chain(new InMemoryCounterStore(), {
      raw: rawConfig({ chat_enabled: 'false' }),
    });
    await runAdmission(stages, request(null));
    expect(calls).not.toContain('guestPass');
  });
});
