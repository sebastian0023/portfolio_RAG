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
  dailyCapStage,
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
    spy('provider', providerStage(registry())),
    spy(
      'dailyCap',
      dailyCapStage(store, () => NOW),
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
  test('admits and reports the site-wide daily remainder as the quota', async () => {
    const store = new InMemoryCounterStore();
    const { stages } = chain(store);
    const ctx = viewer();
    expect(await runAdmission(stages, ctx)).toBeUndefined();
    expect(ctx.quota).toEqual({ principal: 'guest', left: 29, limit: 30 });
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
      'provider',
      'dailyCap',
    ]);
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
    expect(calls).not.toContain('dailyCap');
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

  test('the 30th daily message is admitted and the 31st gets site_limit', async () => {
    const store = new InMemoryCounterStore();
    const raw = rawConfig({
      limits: JSON.stringify({
        ...JSON.parse(rawConfig()['limits'] as string),
        preAuthPerIpPerMinute: 100,
        preAuthGlobalPerMinute: 100,
      }),
    });
    let last;
    for (let i = 1; i <= 30; i += 1) {
      const ctx = viewer();
      expect(await runAdmission(chain(store, raw).stages, ctx)).toBeUndefined();
      last = ctx.quota;
    }
    expect(last).toEqual({ principal: 'guest', left: 0, limit: 30 });
    expect(
      await runAdmission(chain(store, raw).stages, viewer()),
    ).toMatchObject({
      code: 'site_limit',
      status: 429,
    });
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

  test('a daily-cap store failure after the rate check also refuses', async () => {
    const store = new InMemoryCounterStore();
    const original = store.reserve.bind(store);
    store.reserve = () => Promise.reject(new Error('down'));
    expect(await runAdmission(chain(store).stages, viewer())).toMatchObject({
      status: 503,
    });
    store.reserve = original;
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
