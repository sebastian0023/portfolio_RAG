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
import { ProviderRegistry } from '../llm/provider-registry.js';
import { fakeProvider } from '../../testing/fake-llm-provider.js';
import { configFrom, context, rawConfig } from '../../testing/helpers.js';
import { InMemoryCounterStore } from '../../testing/in-memory-counter-store.js';
import {
  chatEnabledStage,
  guestQuotaStage,
  indexReadyStage,
  preAuthRateStage,
  trustedIpStage,
} from './stages.js';

const NOW = Date.parse('2026-10-04T12:34:30Z');
const registry = () =>
  new ProviderRegistry().register(
    'bedrock-runtime',
    () => fakeProvider({ kind: 'text', chunks: [] }).provider,
  );

function chain(
  store: InMemoryCounterStore,
  raw = rawConfig(),
  probe?: AdmissionStage,
) {
  const calls: string[] = [];
  const spy =
    (name: string, stage: AdmissionStage): AdmissionStage =>
    async (ctx) => {
      calls.push(name);
      return stage(ctx);
    };
  const stages = [
    spy('contentType', contentTypeStage),
    spy('byteCap', byteCapStage),
    spy('schema', schemaStage),
    spy('config', configStage(configFrom(raw))),
    spy('trustedIp', trustedIpStage),
    spy(
      'rate',
      preAuthRateStage(store, () => NOW),
    ),
    spy('chatEnabled', chatEnabledStage),
    spy('indexReady', indexReadyStage),
    spy('provider', providerStage(registry())),
    spy(
      'guestQuota',
      guestQuotaStage(store, () => NOW),
    ),
    ...(probe ? [spy('probe', probe)] : []),
  ];
  return { stages, calls };
}

const viewer = (address = '203.0.113.9:4444') => {
  const headers = new Headers({ 'cloudfront-viewer-address': address });
  return context({ headers });
};

describe('admission stages (ADR-016, ADR-017)', () => {
  test("admits and reports the remainder of the visitor's own quota", async () => {
    const store = new InMemoryCounterStore();
    const { stages } = chain(store);
    const ctx = viewer();
    expect(await runAdmission(stages, ctx)).toBeUndefined();
    expect(ctx.quota).toEqual({ left: 9, limit: 10 });
    expect(ctx.provider).toBeDefined();
  });

  test('runs the stages in the documented order', async () => {
    const { stages, calls } = chain(new InMemoryCounterStore());
    await runAdmission(stages, viewer());
    expect(calls).toEqual([
      'contentType',
      'byteCap',
      'schema',
      'config',
      'trustedIp',
      'rate',
      'chatEnabled',
      'indexReady',
      'provider',
      'guestQuota',
    ]);
  });

  test('refuses while no index is active, before the provider and without spending the quota', async () => {
    const store = new InMemoryCounterStore();
    const { stages, calls } = chain(store, rawConfig({ active_index: 'none' }));
    const ctx = viewer();
    expect(await runAdmission(stages, ctx)).toMatchObject({
      code: 'unavailable',
      status: 503,
    });
    expect(calls).toEqual([
      'contentType',
      'byteCap',
      'schema',
      'config',
      'trustedIp',
      'rate',
      'chatEnabled',
      'indexReady',
    ]);
    expect(ctx.provider).toBeUndefined();
    expect(ctx.quota).toBeUndefined();
  });

  test('refuses when the viewer address is missing or ambiguous, without touching a counter', async () => {
    for (const value of [null, '', '1.1.1.1:1, 2.2.2.2:2', 'garbage']) {
      const store = new InMemoryCounterStore();
      const { stages } = chain(store);
      const headers = new Headers(
        value === null ? {} : { 'cloudfront-viewer-address': value },
      );
      expect(await runAdmission(stages, context({ headers }))).toMatchObject({
        status: 503,
        code: 'unavailable',
      });
      expect(store.counts.size).toBe(0);
    }
  });

  test('ignores a spoofed X-Forwarded-For: the bucket follows the trusted header', async () => {
    const store = new InMemoryCounterStore();
    const { stages } = chain(store);
    const headers = new Headers({
      'cloudfront-viewer-address': '203.0.113.9:4444',
      'x-forwarded-for': '198.51.100.77',
      'x-real-ip': '198.51.100.78',
    });
    await runAdmission(stages, context({ headers }));
    const ipKeys = [...store.counts.keys()].filter((k) =>
      k.startsWith('rate#ip#'),
    );
    expect(ipKeys).toHaveLength(1);
    const again = new Headers({
      'cloudfront-viewer-address': '203.0.113.9:5555',
      'x-forwarded-for': '10.9.8.7',
    });
    await runAdmission(chain(store).stages, context({ headers: again }));
    expect(store.counts.get(ipKeys[0] as string)).toBe(2);
  });

  test('the 10th request in a minute is admitted and the 11th is rate limited', async () => {
    const store = new InMemoryCounterStore();
    for (let i = 1; i <= 10; i += 1) {
      expect(await runAdmission(chain(store).stages, viewer())).toBeUndefined();
    }
    const rejection = await runAdmission(chain(store).stages, viewer());
    expect(rejection).toMatchObject({
      code: 'rate_limited',
      status: 429,
      retryAfterSeconds: 30,
    });
  });

  test('a different viewer is not affected by one viewer reaching its limit', async () => {
    const store = new InMemoryCounterStore();
    for (let i = 0; i < 10; i += 1)
      await runAdmission(chain(store).stages, viewer());
    expect(
      await runAdmission(chain(store).stages, viewer('198.51.100.5:1')),
    ).toBeUndefined();
  });

  test('the global per-minute limit applies across viewers', async () => {
    const store = new InMemoryCounterStore();
    const raw = rawConfig({
      limits: JSON.stringify({
        ...JSON.parse(rawConfig()['limits'] as string),
        preAuthGlobalPerMinute: 3,
        globalPerDay: 100,
      }),
    });
    for (let i = 0; i < 3; i += 1) {
      expect(
        await runAdmission(
          chain(store, raw).stages,
          viewer(`198.51.100.${i + 1}:1`),
        ),
      ).toBeUndefined();
    }
    expect(
      await runAdmission(chain(store, raw).stages, viewer('198.51.100.9:1')),
    ).toMatchObject({
      code: 'rate_limited',
    });
  });

  test('rate limiting runs with chat off and costs nothing', async () => {
    const store = new InMemoryCounterStore();
    const raw = rawConfig({ chat_enabled: 'false' });
    for (let i = 0; i < 10; i += 1) {
      expect(
        await runAdmission(chain(store, raw).stages, viewer()),
      ).toMatchObject({ code: 'unavailable', status: 503 });
    }
    expect(
      await runAdmission(chain(store, raw).stages, viewer()),
    ).toMatchObject({ code: 'rate_limited' });
    expect([...store.counts.keys()].some((k) => k.startsWith('quota#'))).toBe(
      false,
    );
  });

  test('chat off refuses before a provider is resolved or a daily reservation is made', async () => {
    const store = new InMemoryCounterStore();
    const { stages, calls } = chain(
      store,
      rawConfig({ chat_enabled: 'false' }),
    );
    expect(await runAdmission(stages, viewer())).toMatchObject({ status: 503 });
    expect(calls).not.toContain('provider');
    expect(calls).not.toContain('guestQuota');
    expect([...store.counts.keys()].some((k) => k.startsWith('quota#'))).toBe(
      false,
    );
  });

  test('an unregistered provider refuses before the daily reservation', async () => {
    const store = new InMemoryCounterStore();
    const raw = rawConfig({
      llm_config: JSON.stringify({
        provider: 'bedrock-mantle',
        model: 'google.gemma-4-26b-a4b',
      }),
    });
    expect(
      await runAdmission(chain(store, raw).stages, viewer()),
    ).toMatchObject({ status: 503 });
    expect([...store.counts.keys()].some((k) => k.startsWith('quota#'))).toBe(
      false,
    );
  });

  const loose = (extra: Record<string, number> = {}) =>
    rawConfig({
      limits: JSON.stringify({
        ...JSON.parse(rawConfig()['limits'] as string),
        preAuthPerIpPerMinute: 1000,
        preAuthGlobalPerMinute: 1000,
        ...extra,
      }),
    });

  test('a visitor gets 10 questions a day: the 10th is admitted with none left, the 11th is quota_exhausted', async () => {
    const store = new InMemoryCounterStore();
    const raw = loose();
    let last;
    for (let i = 1; i <= 10; i += 1) {
      const ctx = viewer();
      expect(await runAdmission(chain(store, raw).stages, ctx)).toBeUndefined();
      last = ctx.quota;
    }
    expect(last).toEqual({ left: 0, limit: 10 });
    expect(
      await runAdmission(chain(store, raw).stages, viewer()),
    ).toMatchObject({ code: 'quota_exhausted', status: 429 });
  });

  test('the count counts down per visitor as questions are admitted', async () => {
    const store = new InMemoryCounterStore();
    const lefts: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const ctx = viewer();
      await runAdmission(chain(store, loose()).stages, ctx);
      lefts.push(ctx.quota?.left ?? -1);
    }
    expect(lefts).toEqual([9, 8, 7]);
  });

  test("another visitor's quota is untouched when one visitor runs out", async () => {
    const store = new InMemoryCounterStore();
    const raw = loose();
    for (let i = 0; i < 11; i += 1) {
      await runAdmission(chain(store, raw).stages, viewer());
    }
    const other = viewer('198.51.100.5:1');
    expect(await runAdmission(chain(store, raw).stages, other)).toBeUndefined();
    expect(other.quota).toEqual({ left: 9, limit: 10 });
  });

  test('the whole site gets 50 a day: the 51st question from a new visitor is site_limit', async () => {
    const store = new InMemoryCounterStore();
    const raw = loose();
    for (let i = 1; i <= 50; i += 1) {
      const ctx = viewer(`198.51.${i}.1:1`);
      expect(await runAdmission(chain(store, raw).stages, ctx)).toBeUndefined();
    }
    expect(
      await runAdmission(chain(store, raw).stages, viewer('198.51.200.1:1')),
    ).toMatchObject({ code: 'site_limit', status: 429 });
  });

  test('a visitor who is out of questions does not use up site capacity', async () => {
    const store = new InMemoryCounterStore();
    const raw = loose();
    for (let i = 0; i < 25; i += 1) {
      await runAdmission(chain(store, raw).stages, viewer());
    }
    // Ten were admitted; the other fifteen were refused on the visitor's own limit.
    const globalKey = [...store.counts.keys()].find((k) =>
      k.startsWith('quota#global#'),
    );
    expect(store.counts.get(globalKey as string)).toBe(10);
  });

  test('the daily counters reset in the next UTC day, not by TTL', async () => {
    const store = new InMemoryCounterStore();
    const ctx1 = viewer();
    const stage = guestQuotaStage(store, () => NOW);
    const next = guestQuotaStage(store, () => NOW + 86_400_000);
    const prep = chain(store, loose()).stages.slice(0, 5);
    await runAdmission(prep, ctx1);
    expect(await stage(ctx1)).toBeUndefined();
    expect(ctx1.quota).toEqual({ left: 9, limit: 10 });
    const ctx2 = viewer();
    await runAdmission(prep, ctx2);
    expect(await next(ctx2)).toBeUndefined();
    expect(ctx2.quota).toEqual({ left: 9, limit: 10 });
  });

  test('the visitor key holds a hash, never the address', async () => {
    const store = new InMemoryCounterStore();
    await runAdmission(
      chain(store, loose()).stages,
      viewer('203.0.113.9:4444'),
    );
    for (const key of store.counts.keys())
      expect(key).not.toContain('203.0.113.9');
  });

  test('a counter store failure refuses and never admits (fail closed)', async () => {
    const store = new InMemoryCounterStore();
    store.failWith = new Error('dynamodb down');
    const { stages, calls } = chain(store);
    expect(await runAdmission(stages, viewer())).toMatchObject({
      status: 503,
      code: 'unavailable',
    });
    expect(calls).not.toContain('chatEnabled');
  });

  test('a failure reading the count back refuses, and the reservation stays counted', async () => {
    const store = new InMemoryCounterStore();
    store.read = () => Promise.reject(new Error('down'));
    expect(await runAdmission(chain(store).stages, viewer())).toMatchObject({
      status: 503,
      code: 'unavailable',
    });
    expect(
      [...store.counts.keys()].some((k) => k.startsWith('quota#ip#')),
    ).toBe(true);
  });

  test('a request refused before the rate stage reserves nothing', async () => {
    const store = new InMemoryCounterStore();
    await runAdmission(
      chain(store).stages,
      context({ contentType: 'text/plain' }),
    );
    await runAdmission(
      chain(store).stages,
      context({ json: { question: '', history: [] } }),
    );
    expect(store.counts.size).toBe(0);
  });

  test('a new minute starts a fresh count', async () => {
    const store = new InMemoryCounterStore();
    for (let i = 0; i < 10; i += 1)
      await runAdmission(chain(store).stages, viewer());
    const later = preAuthRateStage(store, () => NOW + 60_000);
    const ctx = viewer();
    await runAdmission(chain(store).stages.slice(0, 5), ctx);
    expect(await later(ctx)).toBeUndefined();
  });
});
