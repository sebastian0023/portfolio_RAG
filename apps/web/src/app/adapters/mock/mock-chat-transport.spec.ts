import type { ChatRequest, ChatStreamEvent } from '@portfolio/shared';
import { chatStreamEventSchema } from '@portfolio/shared/chat-stream-schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Q_AWS, Q_BEST_AT, Q_STUDYING } from '../../content/suggestions';
import { NetworkError } from '../../core/ports/chat-transport';
import { createMockConfig, type MockConfig } from './mock-config';
import { MockChatTransport } from './mock-chat-transport';
import { MockSession } from './mock-session';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const request = (question: string): ChatRequest => ({ question, history: [] });

async function collect(
  config: MockConfig,
  question: string,
  signal = new AbortController().signal,
  session = new MockSession(config),
): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  const run = (async () => {
    for await (const event of new MockChatTransport(config, session).send(
      request(question),
      signal,
    )) {
      events.push(event);
    }
  })();
  const settled = run.then(
    () => undefined,
    (error: unknown) => error,
  );
  await vi.runAllTimersAsync();
  const failure = await settled;
  if (failure) throw failure;
  return events;
}

describe('MockChatTransport', () => {
  it('emits accepted, sources, deltas, then done, in that order', async () => {
    const events = await collect(createMockConfig(), Q_STUDYING);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('accepted');
    expect(types[1]).toBe('sources');
    expect(types.at(-1)).toBe('done');
    expect(types.slice(2, -1).every((t) => t === 'delta')).toBe(true);
    expect(events.at(-1)).toMatchObject({
      coverage: 'answered',
      cited: [1, 2],
    });
  });

  it('only emits events the real contract accepts', async () => {
    const config = createMockConfig({
      outcomes: [
        'ok',
        { interruptAfter: 3 },
        { error: 'rate_limited', retryAfterSeconds: 28 },
      ],
    });
    const all = [
      ...(await collect(config, Q_AWS)),
      ...(await collect(config, Q_AWS)),
      ...(await collect(config, Q_AWS)),
      ...(await collect(createMockConfig(), 'An unknown question')),
    ];
    expect(all.length).toBeGreaterThan(10);
    for (const event of all) {
      expect(
        chatStreamEventSchema.safeParse(event).success,
        JSON.stringify(event),
      ).toBe(true);
    }
  });

  it('streams the streamed text back to the exact canned answer', async () => {
    const events = await collect(createMockConfig(), Q_STUDYING);
    const text = events
      .flatMap((e) => (e.type === 'delta' ? [e.text] : []))
      .join('');
    expect(text).toContain('Systems Engineering at ITESO');
    expect(text).toMatch(/\[1\]/);
  });

  it('reports no coverage with no sources for an unknown question', async () => {
    const events = await collect(createMockConfig(), 'What is the weather?');
    expect(events.some((e) => e.type === 'sources')).toBe(false);
    expect(events.at(-1)).toEqual({
      type: 'done',
      coverage: 'none',
      cited: [],
    });
  });

  it('cites a marker whose source could not be attached', async () => {
    const events = await collect(createMockConfig(), Q_BEST_AT);
    expect(events.at(-1)).toMatchObject({ type: 'done', cited: [2, 6] });
    const sources = events.find((e) => e.type === 'sources');
    expect(
      sources?.type === 'sources' && sources.sources.map((s) => s.n),
    ).toEqual([2]);
  });

  it('counts down the guest quota and refuses at zero without streaming', async () => {
    const config = createMockConfig({ guestLeft: 1 });
    const first = await collect(config, Q_STUDYING);
    expect(first[0]).toEqual({
      type: 'accepted',
      quota: { left: 0, limit: 3, principal: 'guest' },
    });
    expect(await collect(config, Q_STUDYING)).toEqual([
      { type: 'error', error: { code: 'quota_exhausted' } },
    ]);
    expect(config.guestLeft).toBe(0);
  });

  it('uses the signed-in quota for a signed-in session', async () => {
    const config = createMockConfig({ userLeft: 2 });
    const session = new MockSession(config, { status: 'signed-in' });
    const events = await collect(
      config,
      Q_STUDYING,
      new AbortController().signal,
      session,
    );
    expect(events[0]).toEqual({
      type: 'accepted',
      quota: { left: 1, limit: 10, principal: 'user' },
    });
    expect(config.guestLeft).toBe(3);
  });

  it.each([
    [{ enabled: false }, 'unavailable'],
    [{ siteLimited: true }, 'site_limit'],
  ] as const)(
    'refuses with %o as %s before reserving quota',
    async (override, code) => {
      const config = createMockConfig(override);
      expect(await collect(config, Q_STUDYING)).toEqual([
        { type: 'error', error: { code } },
      ]);
      expect(config.guestLeft).toBe(3);
    },
  );

  it('rejects an over-long question before reserving quota', async () => {
    const config = createMockConfig();
    const events = await collect(config, 'a'.repeat(501));
    expect(events).toEqual([{ type: 'error', error: { code: 'too_long' } }]);
    expect(config.guestLeft).toBe(3);
  });

  it('plays scripted outcomes in order, then returns to normal', async () => {
    const config = createMockConfig({
      outcomes: [{ error: 'rate_limited', retryAfterSeconds: 5 }],
    });
    expect(await collect(config, Q_STUDYING)).toEqual([
      { type: 'error', error: { code: 'rate_limited', retryAfterSeconds: 5 } },
    ]);
    expect((await collect(config, Q_STUDYING)).at(-1)?.type).toBe('done');
  });

  it('throws a NetworkError for the network outcome', async () => {
    await expect(
      collect(createMockConfig({ outcomes: ['network'] }), Q_STUDYING),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('ends the stream with no events after accepted for the empty outcome', async () => {
    const events = await collect(
      createMockConfig({ outcomes: ['empty'] }),
      Q_STUDYING,
    );
    expect(events.map((e) => e.type)).toEqual(['accepted']);
  });

  it('interrupts after the requested number of tokens', async () => {
    const events = await collect(
      createMockConfig({ outcomes: [{ interruptAfter: 2 }] }),
      Q_STUDYING,
    );
    expect(events.filter((e) => e.type === 'delta')).toHaveLength(2);
    expect(events.at(-1)).toEqual({
      type: 'error',
      error: { code: 'interrupted' },
    });
  });

  it('stops promptly when aborted mid-stream and keeps the reservation', async () => {
    const config = createMockConfig();
    const controller = new AbortController();
    const seen: ChatStreamEvent[] = [];
    const run = (async () => {
      for await (const event of new MockChatTransport(
        config,
        new MockSession(config),
      ).send(request(Q_STUDYING), controller.signal)) {
        seen.push(event);
        if (event.type === 'delta') controller.abort();
      }
    })();
    const outcome = run.then(
      () => 'finished',
      (error: unknown) =>
        error instanceof DOMException ? error.name : 'other',
    );
    await vi.runAllTimersAsync();
    expect(await outcome).toBe('AbortError');
    expect(seen.filter((e) => e.type === 'delta')).toHaveLength(1);
    expect(config.guestLeft).toBe(2);
  });
});
