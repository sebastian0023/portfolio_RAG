// The cost-abuse suite (P4-06, abuse-budgets.md). It drives the real stage chain and the real chat handler with
// a model that counts its calls, so every case proves the claim that matters: a refused request never reaches a
// paid call, and an admitted one is counted exactly once.
import type { LLMEvent } from '@portfolio/shared';
import { describe, expect, test } from 'vitest';
import { scriptedProvider } from '../../testing/fake-llm-provider.js';
import { configFrom, memoryLogger, rawConfig } from '../../testing/helpers.js';
import {
  OFF_TOPIC_QUESTION,
  STUDY_PASSAGE,
  STUDY_QUESTION,
  fakeRetrieval,
} from '../../testing/fake-retrieval.js';
import { InMemoryCounterStore } from '../../testing/in-memory-counter-store.js';
import {
  byteCapStage,
  configStage,
  contentTypeStage,
  providerStage,
  schemaStage,
  type AdmissionContext,
} from '../chat/admission.js';
import { createChatHandler } from '../chat/chat-handler.js';
import {
  createGuestPassHandler,
  guestTokenStage,
} from '../guest/guest-pass-handler.js';
import { issuePass } from '../guest/guest-pass.js';
import { CachedSecrets } from '../guest/secrets.js';
import type { TurnstileOutcome } from '../guest/turnstile-port.js';
import { ProviderRegistry } from '../llm/provider-registry.js';
import { createRagService } from '../rag/rag-service.js';
import {
  chatEnabledStage,
  guestPassStage,
  guestQuotaStage,
  indexReadyStage,
  preAuthRateStage,
  trustedIpStage,
} from './stages.js';
import { fingerprint } from './windows.js';

const NOW = Date.parse('2026-10-04T12:34:30Z');
const KEY = 'k'.repeat(48);
const ANSWER: LLMEvent[] = [
  { type: 'delta', text: 'ok' },
  { type: 'done', stopReason: 'end' },
];

interface Options {
  readonly raw?: Record<string, string>;
  readonly store?: InMemoryCounterStore;
  readonly secretsGood?: boolean;
  readonly secretsFail?: boolean;
  readonly now?: number;
}

// Per-minute limits are loosened by default so the daily limits can be reached inside one test minute.
const loose = (extra: Record<string, number> = {}): Record<string, string> =>
  rawConfig({
    limits: JSON.stringify({
      ...JSON.parse(rawConfig()['limits'] as string),
      preAuthPerIpPerMinute: 1000,
      preAuthGlobalPerMinute: 1000,
      ...extra,
    }),
  });

function build(options: Options = {}) {
  const now = options.now ?? NOW;
  const provider = scriptedProvider(ANSWER);
  const registry = new ProviderRegistry().register(
    'bedrock-runtime',
    () => provider,
  );
  const store = options.store ?? new InMemoryCounterStore();
  const logger = memoryLogger();
  const retrieval = fakeRetrieval([STUDY_PASSAGE]);
  const secrets = new CachedSecrets({
    load: () =>
      options.secretsFail
        ? Promise.reject(new Error('ssm down'))
        : Promise.resolve(
            options.secretsGood === false
              ? { turnstile_secret: 'unset', guest_pass_key: 'unset' }
              : { turnstile_secret: 'turnstile-secret', guest_pass_key: KEY },
          ),
  });
  const handler = createChatHandler({
    stages: [
      contentTypeStage,
      byteCapStage,
      schemaStage,
      configStage(configFrom(options.raw ?? loose())),
      trustedIpStage,
      preAuthRateStage(store, () => now),
      chatEnabledStage,
      indexReadyStage,
      guestPassStage(secrets, () => now),
      providerStage(registry),
      guestQuotaStage(store, () => now),
    ],
    service: createRagService({ ...retrieval, logger }),
    logger,
  });
  return { handler, provider, store, secrets, logger, retrieval };
}

type Built = ReturnType<typeof build>;

const passFor = (ip: string, issuedAt = NOW, key = KEY): string =>
  issuePass(key, fingerprint(`v4:${ip}`), issuedAt).pass;

interface Ask {
  readonly ip?: string;
  readonly pass?: string | null;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly question?: string;
}

function contextFor(ask: Ask): AdmissionContext {
  const ip = ask.ip ?? '203.0.113.9';
  const headers = new Headers({
    'cloudfront-viewer-address': `${ip}:4444`,
    ...ask.headers,
  });
  const pass = ask.pass === undefined ? passFor(ip) : ask.pass;
  if (pass !== null) headers.set('x-auth-token', pass);
  return {
    contentType: 'application/json',
    headers,
    body: new Blob([
      JSON.stringify({ question: ask.question ?? STUDY_QUESTION, history: [] }),
    ]).stream(),
    signal: ask.signal ?? new AbortController().signal,
  };
}

async function ask(h: Built, a: Ask = {}) {
  const response = await h.handler(contextFor(a), 'req');
  const events = [];
  for await (const event of response.events) events.push(event);
  return { status: response.status, events };
}

const code = (r: { events: { type: string }[] }): string | undefined => {
  const first = r.events[0] as
    { type: string; error?: { code: string } } | undefined;
  return first?.type === 'error' ? first.error?.code : undefined;
};

describe('cost abuse: daily quotas', () => {
  test('the 11th question from one visitor is quota_exhausted and makes no model call', async () => {
    const h = build();
    for (let i = 0; i < 10; i += 1) expect((await ask(h)).status).toBe(200);
    expect(h.provider.requests).toHaveLength(10);
    expect(h.retrieval.embedder.calls()).toBe(10);
    const refused = await ask(h);
    expect(refused.status).toBe(429);
    expect(code(refused)).toBe('quota_exhausted');
    expect(h.provider.requests).toHaveLength(10);
    // Neither the embedding nor the index is touched for a refused question.
    expect(h.retrieval.embedder.calls()).toBe(10);
    expect(h.retrieval.repository.calls()).toBe(10);
  });

  test('the 51st question from a new visitor is site_limit and makes no model call', async () => {
    const h = build();
    for (let i = 1; i <= 50; i += 1) {
      expect((await ask(h, { ip: `198.51.${i}.1` })).status).toBe(200);
    }
    expect(h.provider.requests).toHaveLength(50);
    const refused = await ask(h, { ip: '198.51.200.1' });
    expect(refused.status).toBe(429);
    expect(code(refused)).toBe('site_limit');
    expect(h.provider.requests).toHaveLength(50);
  });

  test('a visitor out of questions never uses up site capacity', async () => {
    const h = build();
    for (let i = 0; i < 40; i += 1) await ask(h);
    expect(h.provider.requests).toHaveLength(10);
    expect(h.store.counts.get(`quota#global#20261004`)).toBe(10);
  });

  test('concurrent requests at the limit admit exactly the remainder, never more', async () => {
    const h = build();
    for (let i = 0; i < 7; i += 1) await ask(h);
    const results = await Promise.all(Array.from({ length: 20 }, () => ask(h)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 429)).toHaveLength(17);
    expect(h.provider.requests).toHaveLength(10);
  });

  test('concurrent requests across the site never pass the site-wide limit', async () => {
    const h = build();
    const results = await Promise.all(
      Array.from({ length: 80 }, (_, i) =>
        ask(h, { ip: `198.51.${(i % 80) + 1}.1` }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(50);
    expect(h.provider.requests).toHaveLength(50);
  });

  test("the day is a new key: yesterday's questions do not count against today", async () => {
    const store = new InMemoryCounterStore();
    const today = build({ store });
    for (let i = 0; i < 10; i += 1) await ask(today);
    expect(code(await ask(today))).toBe('quota_exhausted');

    const tomorrowMs = NOW + 86_400_000;
    const tomorrow = build({ store, now: tomorrowMs });
    const fresh = await ask(tomorrow, {
      pass: passFor('203.0.113.9', tomorrowMs),
    });
    expect(fresh.status).toBe(200);
    expect(fresh.events[0]).toMatchObject({
      type: 'accepted',
      quota: { left: 9, limit: 10 },
    });
    expect(tomorrow.provider.requests).toHaveLength(1);
  });
});

describe('cost abuse: identity cannot be spoofed', () => {
  test('X-Forwarded-For, X-Real-IP and Authorization never change whose quota is used', async () => {
    const h = build();
    for (let i = 0; i < 10; i += 1) {
      await ask(h, {
        headers: {
          'x-forwarded-for': `10.0.0.${i}`,
          'x-real-ip': `10.1.0.${i}`,
          authorization: `Bearer spoof-${i}`,
        },
      });
    }
    const refused = await ask(h, {
      headers: { 'x-forwarded-for': '10.9.9.9', authorization: 'Bearer other' },
    });
    expect(code(refused)).toBe('quota_exhausted');
    expect(h.provider.requests).toHaveLength(10);
  });

  test('a comma-separated viewer address is refused rather than trusted', async () => {
    const h = build();
    const result = await ask(h, {
      headers: { 'cloudfront-viewer-address': '198.51.100.7:1, 203.0.113.9:2' },
    });
    expect(result.status).toBe(503);
    expect(h.provider.requests).toHaveLength(0);
    expect(h.store.counts.size).toBe(0);
  });

  test("a visitor cannot use another visitor's pass", async () => {
    const h = build();
    const result = await ask(h, {
      ip: '203.0.113.9',
      pass: passFor('198.51.100.7'),
    });
    expect(code(result)).toBe('guest_check_failed');
    expect(h.provider.requests).toHaveLength(0);
  });
});

describe('cost abuse: the guest pass', () => {
  test.each([
    ['no pass', null],
    ['a forged pass', passFor('203.0.113.9', NOW, 'z'.repeat(48))],
    ['an expired pass', passFor('203.0.113.9', NOW - 3_700_000)],
    ['garbage', 'not-a-pass'],
  ])(
    '%s is refused with 403 before any quota or model use',
    async (_name, pass) => {
      const h = build();
      const result = await ask(h, { pass });
      expect(result.status).toBe(403);
      expect(code(result)).toBe('guest_check_failed');
      expect(h.provider.requests).toHaveLength(0);
      expect(
        [...h.store.counts.keys()].some((k) => k.startsWith('quota#')),
      ).toBe(false);
    },
  );

  test('a reused Turnstile token is refused and issues no pass', async () => {
    const used = new Set<string>();
    const handler = createGuestPassHandler({
      stages: [
        contentTypeStage,
        byteCapStage,
        guestTokenStage,
        configStage(configFrom(loose())),
        trustedIpStage,
        preAuthRateStage(new InMemoryCounterStore(), () => NOW),
        chatEnabledStage,
      ],
      secrets: new CachedSecrets({
        load: () =>
          Promise.resolve({
            turnstile_secret: 'turnstile-secret',
            guest_pass_key: KEY,
          }),
      }),
      verifier: {
        verify: ({ token }): Promise<TurnstileOutcome> => {
          if (used.has(token)) return Promise.resolve('failed');
          used.add(token);
          return Promise.resolve('passed');
        },
      },
      logger: memoryLogger(),
      now: () => NOW,
    });
    const ctx = (): AdmissionContext => ({
      contentType: 'application/json',
      headers: new Headers({ 'cloudfront-viewer-address': '203.0.113.9:1' }),
      body: new Blob([JSON.stringify({ token: 'ONE-TIME' })]).stream(),
      signal: new AbortController().signal,
    });
    expect((await handler(ctx(), 'a')).status).toBe(200);
    expect(await handler(ctx(), 'b')).toEqual({
      status: 403,
      body: { error: 'guest_check_failed' },
    });
  });
});

describe('cost abuse: reservations are never refunded', () => {
  test('a visitor who disconnects right after accepted still used a question', async () => {
    const h = build();
    const controller = new AbortController();
    const response = await h.handler(
      contextFor({ signal: controller.signal }),
      'req',
    );
    const iterator = response.events[Symbol.asyncIterator]();
    expect(((await iterator.next()).value as { type: string }).type).toBe(
      'accepted',
    );
    controller.abort();
    await iterator.return?.();
    expect(h.store.counts.get('quota#global#20261004')).toBe(1);
    const next = await ask(h);
    expect(next.events[0]).toMatchObject({
      type: 'accepted',
      quota: { left: 8, limit: 10 },
    });
  });

  test('a model that fails right away still used a question', async () => {
    const h = build();
    const failing = scriptedProvider([
      { type: 'error', error: { code: 'unavailable', retryable: true } },
    ]);
    const registry = new ProviderRegistry().register(
      'bedrock-runtime',
      () => failing,
    );
    const handler = createChatHandler({
      stages: [
        contentTypeStage,
        byteCapStage,
        schemaStage,
        configStage(configFrom(loose())),
        trustedIpStage,
        preAuthRateStage(h.store, () => NOW),
        chatEnabledStage,
        indexReadyStage,
        guestPassStage(h.secrets, () => NOW),
        providerStage(registry),
        guestQuotaStage(h.store, () => NOW),
      ],
      service: createRagService({ ...h.retrieval, logger: h.logger }),
      logger: h.logger,
    });
    const response = await handler(contextFor({}), 'req');
    expect(response.status).toBe(503);
    expect(h.store.counts.get('quota#global#20261004')).toBe(1);
  });
});

describe('cost abuse: retrieval (ADR-054)', () => {
  test('no active index refuses with 503 before the pass check, the quota, and every paid call', async () => {
    const h = build({ raw: rawConfig({ active_index: 'none' }) });
    // Even a request with no pass is refused as unavailable, not sent back through the bot check.
    const result = await ask(h, { pass: null });
    expect(result.status).toBe(503);
    expect(code(result)).toBe('unavailable');
    expect(h.retrieval.embedder.calls()).toBe(0);
    expect(h.retrieval.repository.calls()).toBe(0);
    expect(h.provider.requests).toHaveLength(0);
    expect([...h.store.counts.keys()].some((k) => k.startsWith('quota#'))).toBe(
      false,
    );
  });

  test('an off-topic question costs one embedding and one query, uses a question, and makes no model call', async () => {
    const h = build();
    const result = await ask(h, { question: OFF_TOPIC_QUESTION });
    expect(result.status).toBe(200);
    expect(result.events.map((e) => e.type)).toEqual([
      'accepted',
      'delta',
      'done',
    ]);
    expect(result.events.at(-1)).toMatchObject({ coverage: 'none', cited: [] });
    expect(h.retrieval.embedder.calls()).toBe(1);
    expect(h.retrieval.repository.calls()).toBe(1);
    expect(h.provider.requests).toHaveLength(0);
    expect(h.store.counts.get('quota#global#20261004')).toBe(1);
  });

  test('a grounded question costs exactly one embedding, one query, and one model call', async () => {
    const h = build();
    const result = await ask(h);
    expect(result.status).toBe(200);
    expect(result.events.map((e) => e.type)).toEqual([
      'accepted',
      'sources',
      'delta',
      'done',
    ]);
    expect(h.retrieval.embedder.calls()).toBe(1);
    expect(h.retrieval.repository.calls()).toBe(1);
    expect(h.provider.requests).toHaveLength(1);
  });

  test('a failing embedding refuses with 503, makes no model call, and still used a question', async () => {
    const h = build();
    const failing = {
      config: h.retrieval.embedder.config,
      embed: () =>
        Promise.resolve({ ok: false as const, code: 'unavailable' as const }),
    };
    const handler = createChatHandler({
      stages: [
        contentTypeStage,
        byteCapStage,
        schemaStage,
        configStage(configFrom(loose())),
        trustedIpStage,
        preAuthRateStage(h.store, () => NOW),
        chatEnabledStage,
        indexReadyStage,
        guestPassStage(h.secrets, () => NOW),
        providerStage(
          new ProviderRegistry().register('bedrock-runtime', () => h.provider),
        ),
        guestQuotaStage(h.store, () => NOW),
      ],
      service: createRagService({
        embedder: failing,
        repository: h.retrieval.repository,
        logger: h.logger,
      }),
      logger: h.logger,
    });
    const response = await handler(contextFor({}), 'req');
    expect(response.status).toBe(503);
    expect(h.retrieval.repository.calls()).toBe(0);
    expect(h.provider.requests).toHaveLength(0);
    expect(h.store.counts.get('quota#global#20261004')).toBe(1);
  });
});

describe('cost abuse: failures refuse before a paid call (fail closed)', () => {
  test.each([
    ['chat switched off', { raw: rawConfig({ chat_enabled: 'false' }) }],
    [
      'a missing limits parameter',
      {
        raw: (() => {
          const r = loose();
          delete r['limits'];
          return r;
        })(),
      },
    ],
    [
      'an invalid model config',
      { raw: rawConfig({ llm_config: '{"provider":"x","model":"y"}' }) },
    ],
    ['secrets still the placeholder', { secretsGood: false }],
    ['secrets unreadable', { secretsFail: true }],
  ] as const)('%s', async (_name, options) => {
    const h = build(options);
    const result = await ask(h);
    expect(result.status).toBe(503);
    expect(h.provider.requests).toHaveLength(0);
    expect(h.retrieval.embedder.calls()).toBe(0);
    expect(h.retrieval.repository.calls()).toBe(0);
    expect([...h.store.counts.keys()].some((k) => k.startsWith('quota#'))).toBe(
      false,
    );
  });

  test('an unreachable counter store refuses and never admits', async () => {
    const h = build();
    h.store.failWith = new Error('dynamodb down');
    const result = await ask(h);
    expect(result.status).toBe(503);
    expect(h.provider.requests).toHaveLength(0);
  });

  test('a store that fails only when reserving the quota still refuses', async () => {
    const h = build();
    const original = h.store.reserveAll.bind(h.store);
    let calls = 0;
    h.store.reserveAll = (items) => {
      calls += 1;
      return calls === 1 ? original(items) : Promise.reject(new Error('down'));
    };
    const result = await ask(h);
    expect(result.status).toBe(503);
    expect(h.provider.requests).toHaveLength(0);
  });
});

describe('cost abuse: the per-minute brake', () => {
  test('the 11th request in a minute is rate_limited with Retry-After and no model call', async () => {
    const h = build({ raw: rawConfig() });
    const store = h.store;
    for (let i = 0; i < 10; i += 1) await ask(h);
    const refused = await ask(h);
    expect(refused.status).toBe(429);
    expect(code(refused)).toBe('rate_limited');
    expect(h.provider.requests).toHaveLength(10);
    expect(store.counts.size).toBeGreaterThan(0);
  });
});
