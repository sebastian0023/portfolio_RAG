import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../http/sha256';
import {
  TURNSTILE_ACTION,
  TurnstileGuestCheck,
  type TurnstileApi,
} from './turnstile-guest-check';

type RenderOptions = Parameters<TurnstileApi['render']>[1];

class FakeTurnstile implements TurnstileApi {
  renders: { container: HTMLElement; options: RenderOptions }[] = [];
  executes = 0;
  resets = 0;
  // What a run does when executed: deliver a token, fail, or stay quiet.
  onExecute: (options: RenderOptions) => void = (o) => o.callback('TOKEN-1');

  render(container: HTMLElement, options: RenderOptions): string {
    this.renders.push({ container, options });
    return 'widget-1';
  }
  execute(): void {
    this.executes++;
    const options = this.renders[0]?.options;
    if (options) queueMicrotask(() => this.onExecute(options));
  }
  reset(): void {
    this.resets++;
  }
  remove(): void {
    // Not used by the adapter.
  }
}

const NOW = 1_800_000_000_000;

function setup(
  overrides: {
    api?: FakeTurnstile;
    respond?: () => Promise<Response>;
    now?: () => number;
    slot?: HTMLElement | null;
    tokenTimeoutMs?: number;
  } = {},
) {
  const api = overrides.api ?? new FakeTurnstile();
  const slot =
    overrides.slot === undefined
      ? document.createElement('div')
      : overrides.slot;
  const requests: { url: string; init: RequestInit }[] = [];
  const respond =
    overrides.respond ??
    (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            pass: 'v1.payload.sig',
            expiresAt: NOW / 1000 + 3600,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ));
  const check = new TurnstileGuestCheck({
    siteKey: 'SITE-KEY',
    loadApi: () => Promise.resolve(api),
    slot: () => slot,
    fetchImpl: ((url: string, init: RequestInit) => {
      requests.push({ url: String(url), init });
      return respond();
    }) as typeof fetch,
    now: overrides.now ?? (() => NOW),
    ...(overrides.tokenTimeoutMs
      ? { tokenTimeoutMs: overrides.tokenTimeoutMs }
      : {}),
  });
  return { check, api, slot, requests };
}

describe('TurnstileGuestCheck (ADR-052)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is not ready before the first check', () => {
    const { check } = setup();
    expect(check.isReady()).toBe(false);
    expect(check.getPass()).toBeNull();
  });

  it('renders an invisible widget for the chat action, executes it, and trades the token for a pass', async () => {
    const { check, api, slot, requests } = setup();
    expect(await check.verify()).toBe('passed');
    expect(api.renders).toHaveLength(1);
    expect(api.renders[0]?.container).toBe(slot);
    expect(api.renders[0]?.options).toMatchObject({
      sitekey: 'SITE-KEY',
      action: TURNSTILE_ACTION,
      execution: 'execute',
      appearance: 'interaction-only',
    });
    expect(api.executes).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('/api/guest-pass');
    expect(check.isReady()).toBe(true);
    expect(check.getPass()).toBe('v1.payload.sig');
  });

  it('posts the token as JSON with the body hash the edge requires', async () => {
    const { check, requests } = setup();
    await check.verify();
    const init = requests[0]?.init as RequestInit & {
      body: Uint8Array<ArrayBuffer>;
    };
    expect(new TextDecoder().decode(init.body)).toBe('{"token":"TOKEN-1"}');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-amz-content-sha256']).toBe(await sha256Hex(init.body));
    expect(headers['content-type']).toBe('application/json');
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
  });

  it('keeps the widget between runs and resets it after each one', async () => {
    const { check, api } = setup();
    await check.verify();
    api.onExecute = (o) => o.callback('TOKEN-2');
    await check.verify();
    expect(api.renders).toHaveLength(1);
    expect(api.executes).toBe(2);
    expect(api.resets).toBe(2);
  });

  it('shares one run between concurrent callers', async () => {
    const { check, api, requests } = setup();
    const results = await Promise.all([
      check.verify(),
      check.verify(),
      check.verify(),
    ]);
    expect(results).toEqual(['passed', 'passed', 'passed']);
    expect(api.executes).toBe(1);
    expect(requests).toHaveLength(1);
  });

  it('stops being ready a minute before the pass expires', async () => {
    let now = NOW;
    const { check } = setup({ now: () => now });
    await check.verify();
    now = NOW + 3_539_000;
    expect(check.isReady()).toBe(true);
    now = NOW + 3_541_000;
    expect(check.isReady()).toBe(false);
    expect(check.getPass()).toBeNull();
  });

  it('forgets the pass when invalidated', async () => {
    const { check } = setup();
    await check.verify();
    check.invalidate();
    expect(check.isReady()).toBe(false);
  });

  it.each([
    [
      'the widget reports an error',
      (api: FakeTurnstile) => {
        api.onExecute = (o) => o['error-callback']();
      },
    ],
    [
      'the token expires before it is used',
      (api: FakeTurnstile) => {
        api.onExecute = (o) => o['expired-callback']();
      },
    ],
  ])('fails when %s', async (_name, arrange) => {
    const { check, api, requests } = setup();
    arrange(api);
    expect(await check.verify()).toBe('failed');
    expect(requests).toHaveLength(0);
    expect(check.isReady()).toBe(false);
  });

  it('fails after the timeout when the widget never answers', async () => {
    const { check, api } = setup({ tokenTimeoutMs: 5_000 });
    api.onExecute = () => undefined;
    const run = check.verify();
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await run).toBe('failed');
  });

  it('can run again after a failure', async () => {
    const { check, api } = setup();
    api.onExecute = (o) => o['error-callback']();
    expect(await check.verify()).toBe('failed');
    api.onExecute = (o) => o.callback('TOKEN-RETRY');
    expect(await check.verify()).toBe('passed');
  });

  it.each([
    [
      'a 403 refusal',
      () =>
        Promise.resolve(
          new Response('{"error":"guest_check_failed"}', { status: 403 }),
        ),
    ],
    [
      'a 503',
      () =>
        Promise.resolve(
          new Response('{"error":"unavailable"}', { status: 503 }),
        ),
    ],
    [
      'a 429',
      () =>
        Promise.resolve(
          new Response('{"error":"rate_limited","retryAfterSeconds":9}', {
            status: 429,
          }),
        ),
    ],
    [
      'a 200 with an error body',
      () =>
        Promise.resolve(
          new Response('{"error":"unavailable"}', { status: 200 }),
        ),
    ],
    [
      'a body that is not JSON',
      () => Promise.resolve(new Response('<html>', { status: 200 })),
    ],
    [
      'a pass of the wrong shape',
      () =>
        Promise.resolve(
          new Response('{"pass":1,"expiresAt":"soon"}', { status: 200 }),
        ),
    ],
    ['a network failure', () => Promise.reject(new TypeError('offline'))],
  ])('fails on %s and holds no pass', async (_name, respond) => {
    const { check } = setup({ respond });
    expect(await check.verify()).toBe('failed');
    expect(check.isReady()).toBe(false);
  });

  it('fails, without throwing, when there is nowhere to show the widget', async () => {
    const { check, api } = setup({ slot: null });
    expect(await check.verify()).toBe('failed');
    expect(api.renders).toHaveLength(0);
  });

  it('fails, without throwing, when Cloudflare cannot be loaded', async () => {
    const check = new TurnstileGuestCheck({
      siteKey: 'k',
      loadApi: () => Promise.reject(new Error('blocked')),
      slot: () => document.createElement('div'),
    });
    expect(await check.verify()).toBe('failed');
  });

  it('fails when the caller aborts mid-check', async () => {
    const { check, api } = setup();
    api.onExecute = () => undefined;
    const controller = new AbortController();
    const run = check.verify(controller.signal);
    await Promise.resolve();
    controller.abort();
    expect(await run).toBe('failed');
  });
});
