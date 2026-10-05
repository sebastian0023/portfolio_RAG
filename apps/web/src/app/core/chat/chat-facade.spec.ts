import type { ChatErrorCode } from '@portfolio/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage } from './chat-state';
import { NetworkError } from '../ports/chat-transport';
import { quota, setup, source } from './chat.testing';

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};
const assistant = (h: ReturnType<typeof setup>): AssistantMessage =>
  h.facade.lastAssistant()!;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ChatFacade: answer lifecycle', () => {
  it('streams an answer through submitting, streaming, and complete', async () => {
    const h = setup();
    expect(h.facade.phase()).toBe('idle');

    void h.facade.send('What is Daniel studying?');
    await flush();
    expect(h.facade.phase()).toBe('submitting');
    expect(h.facade.messages().map((m) => m.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(h.facade.input()).toBe('');
    expect(h.facade.quota().left).toBe(9); // optimistic until the server confirms

    const ch = h.transport.last;
    ch.emit({ type: 'accepted', quota: quota(2) });
    ch.emit({ type: 'sources', sources: [source(1)] });
    ch.emit({ type: 'delta', text: 'Systems ' });
    await flush();
    expect(h.facade.phase()).toBe('streaming');
    ch.emit({ type: 'delta', text: 'Engineering [1].' });
    ch.emit({ type: 'done', coverage: 'answered', cited: [1] });
    await flush();

    expect(h.facade.phase()).toBe('complete');
    expect(assistant(h)).toMatchObject({
      status: 'done',
      text: 'Systems Engineering [1].',
      coverage: 'answered',
    });
    expect(h.facade.busy()).toBe(false);
  });

  it('stays complete when the stream closes normally after done', async () => {
    const h = setup();
    void h.facade.send('Q');
    await flush();
    const ch = h.transport.last;
    ch.emit({ type: 'accepted', quota: quota(2) });
    ch.emit({ type: 'delta', text: 'Answer' });
    ch.emit({ type: 'done', coverage: 'answered', cited: [] });
    ch.end();
    await flush();
    expect(h.facade.phase()).toBe('complete');
    expect(h.facade.alertText()).toBe('');
  });

  it('announces phase changes once, not once per token', async () => {
    const h = setup();
    const announced: string[] = [];
    void h.facade.send('Q');
    await flush();
    announced.push(h.facade.liveText());
    const ch = h.transport.last;
    ch.emit({ type: 'accepted', quota: quota(2) });
    for (const word of ['a ', 'b ', 'c ', 'd ']) {
      ch.emit({ type: 'delta', text: word });
      await flush();
      if (announced.at(-1) !== h.facade.liveText())
        announced.push(h.facade.liveText());
    }
    ch.emit({ type: 'done', coverage: 'answered', cited: [] });
    await flush();
    announced.push(h.facade.liveText());
    expect(announced).toEqual([
      'AI assistant is thinking',
      'AI assistant is answering',
      'AI assistant answered: a b c d',
    ]);
  });

  it('ignores a second send while an answer is in flight', async () => {
    const h = setup();
    void h.facade.send('first');
    await flush();
    void h.facade.send('second');
    await flush();
    expect(h.transport.calls).toHaveLength(1);
  });

  it('treats a stream that ends without done as interrupted and keeps the partial text', async () => {
    const h = setup();
    void h.facade.send('Q');
    await flush();
    const ch = h.transport.last;
    ch.emit({ type: 'accepted', quota: quota(2) });
    ch.emit({ type: 'delta', text: 'Partial ' });
    ch.end();
    await flush();
    expect(h.facade.phase()).toBe('error');
    expect(assistant(h).text).toBe('Partial ');
    expect(h.facade.alertText()).toBe('The answer was interrupted.');
    expect(h.facade.quota().left).toBe(2); // the reservation stays counted
  });

  it('treats an empty response as interrupted rather than a blank answer', async () => {
    const h = setup();
    void h.facade.send('Q');
    await flush();
    h.transport.last.emit({ type: 'accepted', quota: quota(2) });
    h.transport.last.end();
    await flush();
    expect(assistant(h)).toMatchObject({ status: 'error', text: '' });
  });

  it('keeps the partial answer and counts the question when the stream breaks after accepted', async () => {
    const h = setup();
    void h.facade.send('Q');
    await flush();
    const ch = h.transport.last;
    ch.emit({ type: 'accepted', quota: quota(2) });
    ch.emit({ type: 'delta', text: 'Half' });
    ch.fail(new NetworkError('reset'));
    await flush();
    expect(assistant(h)).toMatchObject({ status: 'error', text: 'Half' });
    expect(h.facade.inline()).toBeNull();
    expect(h.facade.messages()).toHaveLength(2);
  });

  it('marks a missing source as unavailable instead of showing its marker', async () => {
    const h = setup();
    void h.facade.send('Q');
    await flush();
    const ch = h.transport.last;
    ch.emit({ type: 'accepted', quota: quota(2) });
    ch.emit({ type: 'sources', sources: [source(2)] });
    ch.emit({ type: 'delta', text: 'Tools [2][6]' });
    ch.emit({ type: 'done', coverage: 'answered', cited: [2, 6] });
    await flush();
    expect([...h.facade.missing(assistant(h))]).toEqual([6]);
    expect(h.facade.plainText(assistant(h))).toBe('Tools [2]');
  });
});

describe('ChatFacade: cancellation and races', () => {
  it('stop keeps the partial answer and ignores events that arrive afterwards', async () => {
    const h = setup();
    void h.facade.send('Q');
    await flush();
    const ch = h.transport.last;
    ch.emit({ type: 'accepted', quota: quota(2) });
    ch.emit({ type: 'delta', text: 'Partial ' });
    await flush();

    h.facade.stop();
    expect(h.facade.phase()).toBe('cancelled');
    expect(h.facade.liveText()).toBe('Answer stopped');

    ch.emit({ type: 'delta', text: 'late ' });
    ch.emit({ type: 'done', coverage: 'answered', cited: [] });
    await flush();
    expect(assistant(h)).toMatchObject({ status: 'stopped', text: 'Partial ' });
    expect(h.facade.quota().left).toBe(2);
  });

  it('stop aborts the transport signal', async () => {
    const h = setup();
    void h.facade.send('Q');
    await flush();
    h.facade.stop();
    await flush();
    expect(h.facade.phase()).toBe('cancelled');
    // Nothing is left running, so a new question may start.
    void h.facade.send('again');
    await flush();
    expect(h.transport.calls).toHaveLength(2);
  });

  it('events from a stopped stream never leak into the next answer', async () => {
    const h = setup({ verified: true, quota: quota(3) });
    void h.facade.send('first');
    await flush();
    const first = h.transport.last;
    first.emit({ type: 'accepted', quota: quota(2) });
    h.facade.stop();

    void h.facade.send('second');
    await flush();
    const second = h.transport.last;
    second.emit({ type: 'accepted', quota: quota(1) });
    second.emit({ type: 'delta', text: 'second answer' });

    first.emit({ type: 'delta', text: 'STALE' });
    first.emit({ type: 'error', error: { code: 'site_limit' } });
    await flush();

    expect(assistant(h).text).toBe('second answer');
    expect(h.facade.siteLimit()).toBe(false);
    expect(h.facade.quota().left).toBe(1);
  });

  it('stop does nothing when no answer is running', () => {
    const h = setup();
    h.facade.stop();
    expect(h.facade.phase()).toBe('idle');
  });
});

describe('ChatFacade: failures before the server accepts', () => {
  async function failWith(
    code: Exclude<ChatErrorCode, 'interrupted'>,
    extra: { retryAfterSeconds?: number } = {},
    seed?: Parameters<typeof setup>[0],
  ) {
    const h = setup(seed);
    void h.facade.send('My question');
    await flush();
    h.transport.last.emit({ type: 'error', error: { code, ...extra } });
    await flush();
    return h;
  }

  it.each(['too_long', 'rate_limited', 'site_limit', 'unavailable'] as const)(
    '%s removes the optimistic bubbles and puts the question back in the composer',
    async (code) => {
      const h = await failWith(code);
      expect(h.facade.messages()).toEqual([]);
      expect(h.facade.input()).toBe('My question');
      expect(h.facade.busy()).toBe(false);
    },
  );

  it('rate_limited starts a live countdown that re-enables sending', async () => {
    const h = await failWith('rate_limited', { retryAfterSeconds: 3 });
    expect(h.facade.inline()).toEqual({ kind: 'rate', seconds: 3 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.facade.inline()).toEqual({ kind: 'rate', seconds: 2 });
    void h.facade.send(); // still blocked
    await flush();
    expect(h.transport.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.facade.inline()).toBeNull();
    void h.facade.send();
    await flush();
    expect(h.transport.calls).toHaveLength(2);
  });

  it('quota_exhausted restores the question and shows zero questions left', async () => {
    const h = await failWith('quota_exhausted');
    expect(h.facade.quota().left).toBe(0);
    expect(h.facade.input()).toBe('My question');
  });

  it('site_limit and unavailable switch the assistant off for everyone', async () => {
    expect((await failWith('site_limit')).facade.siteLimit()).toBe(true);
    expect((await failWith('unavailable')).facade.chatEnabled()).toBe(false);
  });

  it('guest_check_failed asks for the check again', async () => {
    const h = await failWith('guest_check_failed');
    expect(h.facade.check()).toBe('failed');
  });

  it('a network error restores the question, shows the network alert, and retry resends', async () => {
    const h = setup();
    void h.facade.send('My question');
    await flush();
    h.transport.last.fail(new NetworkError('offline'));
    await flush();
    expect(h.facade.inline()).toEqual({ kind: 'network' });
    expect(h.facade.messages()).toEqual([]);
    expect(h.facade.input()).toBe('My question');
    expect(h.facade.quota().left).toBe(10);

    h.facade.retryNetwork();
    await flush();
    expect(h.transport.calls).toHaveLength(2);
    expect(h.transport.last.request.question).toBe('My question');
  });

  it('editing the text clears a network or too-long alert but keeps the rate countdown', async () => {
    const h = setup({ verified: true, inline: { kind: 'network' } });
    h.facade.setInput('x');
    expect(h.facade.inline()).toBeNull();
    const r = await failWith('rate_limited', { retryAfterSeconds: 5 });
    r.facade.setInput('y');
    expect(r.facade.inline()?.kind).toBe('rate');
  });
});

describe('ChatFacade: composer rules', () => {
  it('rejects a question over 500 characters without calling the server', async () => {
    const h = setup();
    await h.facade.send('a'.repeat(501));
    expect(h.transport.calls).toHaveLength(0);
    expect(h.facade.inline()).toEqual({ kind: 'too_long' });
  });

  it('accepts exactly 500 characters', async () => {
    const h = setup();
    void h.facade.send('a'.repeat(500));
    await flush();
    expect(h.transport.calls).toHaveLength(1);
  });

  it('ignores blank input', async () => {
    const h = setup();
    await h.facade.send('   ');
    expect(h.transport.calls).toHaveLength(0);
  });

  it('does not send with no questions left, with the site limit, or with the assistant off', async () => {
    for (const seed of [
      { verified: true, quota: quota(0) },
      { verified: true, siteLimit: true },
      { verified: true, chatEnabled: false },
    ]) {
      const h = setup(seed);
      await h.facade.send('Q');
      expect(h.transport.calls).toHaveLength(0);
    }
  });

  it('sends only the last four finished turns as history', async () => {
    const h = setup({ verified: true, quota: quota(10, 10) });
    for (let i = 1; i <= 3; i++) {
      void h.facade.send(`q${i}`);
      await flush();
      h.transport.last.emit({
        type: 'accepted',
        quota: quota(10 - i, 10),
      });
      h.transport.last.emit({ type: 'delta', text: `a${i}` });
      h.transport.last.emit({ type: 'done', coverage: 'answered', cited: [] });
      await flush();
    }
    void h.facade.send('q4');
    await flush();
    expect(h.transport.last.request.history.map((t) => t.text)).toEqual([
      'q2',
      'a2',
      'q3',
      'a3',
    ]);
  });
});

describe('ChatFacade: guest check', () => {
  it('runs the check before the first question and sends after it passes', async () => {
    const h = setup({});
    let release!: () => void;
    h.guestCheck.gate = new Promise<void>((resolve) => (release = resolve));
    void h.facade.send('Q');
    await flush();
    expect(h.facade.check()).toBe('checking');
    expect(h.facade.phase()).toBe('verifying');
    expect(h.facade.input()).toBe('Q');
    expect(h.transport.calls).toHaveLength(0);

    release();
    await flush();
    expect(h.facade.check()).toBe('passed');
    await vi.advanceTimersByTimeAsync(700);
    expect(h.facade.check()).toBe('idle');
    expect(h.transport.calls).toHaveLength(1);
  });

  it('does not check again once verified', async () => {
    const h = setup({});
    void h.facade.send('one');
    await vi.advanceTimersByTimeAsync(700);
    h.transport.last.emit({ type: 'accepted', quota: quota(2) });
    h.transport.last.emit({ type: 'done', coverage: 'none', cited: [] });
    await flush();
    void h.facade.send('two');
    await flush();
    expect(h.guestCheck.calls).toBe(1);
    expect(h.transport.calls).toHaveLength(2);
  });

  it('a failed check keeps the question and retry sends it', async () => {
    const h = setup({});
    h.guestCheck.results = ['failed', 'passed'];
    void h.facade.send('Q');
    await flush();
    expect(h.facade.check()).toBe('failed');
    expect(h.facade.input()).toBe('Q');
    expect(h.transport.calls).toHaveLength(0);

    void h.facade.retryCheck();
    await vi.advanceTimersByTimeAsync(700);
    expect(h.transport.calls).toHaveLength(1);
  });

  it('checks again when the held pass is no longer usable, even after an earlier pass', async () => {
    const h = setup({ verified: true });
    h.guestCheck.ready = false; // the one-hour pass ran out
    void h.facade.send('Q');
    await vi.advanceTimersByTimeAsync(700);
    expect(h.guestCheck.calls).toBe(1);
    expect(h.transport.calls).toHaveLength(1);
  });

  it('does not check while a usable pass is held', async () => {
    const h = setup({ verified: true });
    void h.facade.send('Q');
    await flush();
    expect(h.guestCheck.calls).toBe(0);
    expect(h.transport.calls).toHaveLength(1);
  });

  it('a refused pass is forgotten, the question comes back, and retry checks then sends', async () => {
    const h = setup({ verified: true });
    void h.facade.send('My question');
    await flush();
    h.transport.last.emit({
      type: 'error',
      error: { code: 'guest_check_failed' },
    });
    await flush();
    expect(h.guestCheck.invalidations).toBe(1);
    expect(h.facade.check()).toBe('failed');
    expect(h.facade.input()).toBe('My question');
    expect(h.facade.messages()).toEqual([]);
    void h.facade.retryCheck();
    await vi.advanceTimersByTimeAsync(700);
    expect(h.guestCheck.calls).toBe(1);
    expect(h.transport.calls).toHaveLength(2);
  });
});

describe('ChatFacade: viewer and toasts', () => {
  it('non-error toasts dismiss themselves', async () => {
    const h = setup();
    h.facade.pushToast('info', 'hello');
    expect(h.facade.toasts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.facade.toasts()).toHaveLength(0);
  });

  it('opens, steps through, and closes the source viewer within bounds', async () => {
    const h = setup({ verified: true });
    void h.facade.send('Q');
    await flush();
    h.transport.last.emit({ type: 'accepted', quota: quota(2) });
    h.transport.last.emit({ type: 'sources', sources: [source(1), source(2)] });
    h.transport.last.emit({ type: 'done', coverage: 'answered', cited: [] });
    await flush();
    const id = assistant(h).id;

    h.facade.openViewer(id, 0);
    expect(h.facade.viewer()).toMatchObject({
      index: 0,
      total: 2,
      hasPrev: false,
      hasNext: true,
    });
    h.facade.moveViewer(-1);
    expect(h.facade.viewer()?.index).toBe(0);
    h.facade.moveViewer(1);
    h.facade.moveViewer(1);
    expect(h.facade.viewer()).toMatchObject({ index: 1, hasNext: false });
    h.facade.closeViewer();
    expect(h.facade.viewer()).toBeNull();
  });
});
