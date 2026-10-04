import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Q_AWS, Q_STUDYING } from '../../content/suggestions';
import { CHAT_SEED } from '../../core/chat/chat-seed';
import { ChatFacade } from '../../core/chat/chat-facade';
import { CHAT_TRANSPORT, GUEST_CHECK_PORT } from '../../core/ports/tokens';
import { readHarness, parseOutcome } from './harness';
import { createMockConfig } from './mock-config';
import { MockChatTransport } from './mock-chat-transport';
import { MockGuestCheck } from './mock-guest-check';
import { buildScenario, SCENARIO_IDS, type ScenarioId } from './scenarios';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function facadeFor(id: ScenarioId): ChatFacade {
  const scenario = buildScenario(id);
  const config = createMockConfig(scenario.config);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: CHAT_TRANSPORT,
        useValue: new MockChatTransport(config),
      },
      { provide: GUEST_CHECK_PORT, useValue: new MockGuestCheck(config) },
      { provide: CHAT_SEED, useValue: scenario.seed },
    ],
  });
  return TestBed.inject(ChatFacade);
}

describe('design scenarios', () => {
  it.each(SCENARIO_IDS)('%s builds a consistent state', (id) => {
    const { seed } = buildScenario(id);
    const ids = (seed.messages ?? []).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    if (seed.quota) {
      expect(seed.quota.left).toBeLessThanOrEqual(seed.quota.limit);
    }
    const facade = facadeFor(id);
    expect(facade.messages().length).toBe(seed.messages?.length ?? 0);
    TestBed.resetTestingModule(); // stops any seeded countdown
  });

  it('every message with sources resolves its viewer', () => {
    const facade = facadeFor('sources');
    expect(facade.viewer()).toMatchObject({ index: 0, total: 2 });
    expect(facade.viewer()?.source.title).toBe('Education');
  });

  it('the streaming frame shows a half-finished answer with its sources held back', () => {
    const facade = facadeFor('streaming');
    expect(facade.phase()).toBe('streaming');
    const last = facade.lastAssistant()!;
    expect(last.text.endsWith('learning ')).toBe(true);
    expect(last.coverage).toBeNull();
  });

  it('frames for errors and stops show partial text', () => {
    expect(facadeFor('error').phase()).toBe('error');
    expect(facadeFor('stopped').phase()).toBe('cancelled');
    expect(facadeFor('thinking').phase()).toBe('submitting');
    expect(facadeFor('nocover').lastAssistant()?.coverage).toBe('none');
  });

  it('the rate-limit frame counts down live', async () => {
    const facade = facadeFor('rateLimit');
    expect(facade.inline()).toEqual({ kind: 'rate', seconds: 28 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(facade.inline()).toEqual({ kind: 'rate', seconds: 25 });
  });

  it('a scenario can be continued against the mock backend with consistent quota', async () => {
    const facade = facadeFor('answered'); // guest, 2 left, verified
    void facade.send(Q_AWS);
    await vi.runAllTimersAsync();
    expect(facade.phase()).toBe('complete');
    expect(facade.quota()).toEqual({ left: 1, limit: 10 });
    expect(facade.messages()).toHaveLength(4);
    void facade.send(Q_STUDYING);
    await vi.runAllTimersAsync();
    expect(facade.quota().left).toBe(0);
    void facade.send(Q_STUDYING);
    await vi.runAllTimersAsync();
    expect(facade.messages()).toHaveLength(6); // refused: nothing sent at zero
  });

  it('the out-of-questions frame has no questions left', () => {
    expect(facadeFor('outGuest').quota().left).toBe(0);
  });
});

describe('harness query parsing', () => {
  it('reads scenario, theme, and outcomes', () => {
    expect(
      readHarness(
        '?scenario=streaming&theme=dark&mock=network,error:rate_limited:9,interrupt:4,ok',
      ),
    ).toEqual({
      scenario: 'streaming',
      theme: 'dark',
      outcomes: [
        'network',
        { error: 'rate_limited', retryAfterSeconds: 9 },
        { interruptAfter: 4 },
        'ok',
      ],
    });
  });

  it('ignores unknown scenarios, themes, and malformed outcomes', () => {
    expect(
      readHarness(
        '?scenario=../../etc&theme=pink&mock=nope,error:teapot,interrupt:x',
      ),
    ).toEqual({
      scenario: null,
      theme: null,
      outcomes: [],
    });
  });

  it('parses hang with and without a token count', () => {
    expect(parseOutcome('hang')).toBe('hang');
    expect(parseOutcome('hang:5')).toEqual({ hangAfter: 5 });
    expect(parseOutcome('error:unavailable')).toEqual({ error: 'unavailable' });
  });
});
