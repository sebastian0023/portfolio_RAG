import { describe, expect, test, vi } from 'vitest';
import {
  CachedConfig,
  DEFAULT_FAILURE_TTL_MS,
  DEFAULT_TTL_MS,
  isChatAllowed,
  type ConfigSource,
} from './cached-config.js';
import { VALIDATED_LLM_CONFIGS } from './runtime-config.js';

const limits = JSON.stringify({
  questionMaxChars: 500,
  requestMaxBytes: 8192,
  historyTurns: 4,
  retrievedChunks: 5,
  chunkMaxTokens: 800,
  promptMaxTokens: 6000,
  outputMaxTokens: 400,
  timeoutSeconds: 30,
  preAuthPerIpPerMinute: 10,
  preAuthGlobalPerMinute: 40,
  guestPerIpPerDay: 10,
  globalPerDay: 50,
});

const raw = (chat: 'true' | 'false') => ({
  chat_enabled: chat,
  active_index: 'none',
  llm_config: JSON.stringify(VALIDATED_LLM_CONFIGS[0]),
  limits,
});

function setup(initial: () => Promise<Record<string, string>>) {
  let clock = 0;
  let loader = initial;
  const load = vi.fn(() => loader());
  const source: ConfigSource = { load };
  const config = new CachedConfig(source, { now: () => clock });
  return {
    config,
    load,
    advance: (ms: number) => {
      clock += ms;
    },
    setLoader: (next: () => Promise<Record<string, string>>) => {
      loader = next;
    },
  };
}

describe('CachedConfig', () => {
  test('loads once within the ttl and serves the cached value', async () => {
    const s = setup(() => Promise.resolve(raw('true')));
    await s.config.get();
    s.advance(DEFAULT_TTL_MS - 1);
    const state = await s.config.get();
    expect(s.load).toHaveBeenCalledTimes(1);
    expect(isChatAllowed(state)).toBe(true);
  });

  test('picks up a changed flag after the ttl expires', async () => {
    const s = setup(() => Promise.resolve(raw('true')));
    expect(isChatAllowed(await s.config.get())).toBe(true);
    s.setLoader(() => Promise.resolve(raw('false')));
    s.advance(DEFAULT_TTL_MS);
    expect(isChatAllowed(await s.config.get())).toBe(false);
    expect(s.load).toHaveBeenCalledTimes(2);
  });

  test('fails closed after the ttl when the source breaks, never serving stale config', async () => {
    const s = setup(() => Promise.resolve(raw('true')));
    expect(isChatAllowed(await s.config.get())).toBe(true);
    s.setLoader(() => Promise.reject(new Error('ssm down')));
    s.advance(DEFAULT_TTL_MS);
    const state = await s.config.get();
    expect(state.status).toBe('unavailable');
    expect(isChatAllowed(state)).toBe(false);
  });

  test('treats a source error as unreadable without leaking its message', async () => {
    const s = setup(() => Promise.reject(new Error('token=SECRET-VALUE')));
    const state = await s.config.get();
    expect(state.status).toBe('unavailable');
    expect(JSON.stringify(state)).not.toContain('SECRET');
  });

  test('turns invalid values into unavailable instead of defaulting', async () => {
    const s = setup(() =>
      Promise.resolve({
        ...raw('true'),
        llm_config: '{"provider":"x","model":"y"}',
      }),
    );
    const state = await s.config.get();
    expect(state.status).toBe('unavailable');
    expect(isChatAllowed(state)).toBe(false);
  });

  test('remembers a failure briefly, then retries', async () => {
    const s = setup(() => Promise.reject(new Error('down')));
    await s.config.get();
    await s.config.get();
    expect(s.load).toHaveBeenCalledTimes(1);
    s.setLoader(() => Promise.resolve(raw('true')));
    s.advance(DEFAULT_FAILURE_TTL_MS);
    expect(isChatAllowed(await s.config.get())).toBe(true);
    expect(s.load).toHaveBeenCalledTimes(2);
  });

  test('shares one refresh between concurrent callers', async () => {
    const s = setup(() => Promise.resolve(raw('true')));
    const states = await Promise.all([
      s.config.get(),
      s.config.get(),
      s.config.get(),
    ]);
    expect(s.load).toHaveBeenCalledTimes(1);
    expect(states.every((state) => state.status === 'ready')).toBe(true);
  });

  test('starts a new refresh after a shared one finishes', async () => {
    const s = setup(() => Promise.resolve(raw('true')));
    await s.config.get();
    s.advance(DEFAULT_TTL_MS);
    await Promise.all([s.config.get(), s.config.get()]);
    expect(s.load).toHaveBeenCalledTimes(2);
  });

  test.each([0, 999, 300_001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an out-of-range ttl of %s',
    (ttlMs) => {
      const source: ConfigSource = { load: () => Promise.resolve({}) };
      expect(() => new CachedConfig(source, { ttlMs })).toThrow(RangeError);
      expect(() => new CachedConfig(source, { failureTtlMs: ttlMs })).toThrow(
        RangeError,
      );
    },
  );
});

describe('isChatAllowed', () => {
  test('is false when ready but the flag is off', async () => {
    const s = setup(() => Promise.resolve(raw('false')));
    expect(isChatAllowed(await s.config.get())).toBe(false);
  });
});
