import { describe, expect, it } from 'vitest';
import {
  composerView,
  limitView,
  meterView,
  resetLabel,
  type ComposerInput,
} from './view-models';

const base: ComposerInput = {
  input: 'hello',
  busy: false,
  chatEnabled: true,
  quota: { left: 3, limit: 3, principal: 'guest' },
  inline: null,
  check: 'idle',
  compact: false,
};

describe('composerView', () => {
  it('allows sending a normal question', () => {
    const v = composerView(base);
    expect(v.sendDisabled).toBe(false);
    expect(v.counter).toEqual({ text: '5 / 500', tone: 'normal', icon: null });
    expect(v.helper.text).toBe('Enter to send · Shift + Enter for a new line');
  });

  it('warns from 450 characters and turns danger over 500, disabling send with the reason', () => {
    expect(composerView({ ...base, input: 'a'.repeat(449) }).counter.tone).toBe(
      'normal',
    );
    expect(composerView({ ...base, input: 'a'.repeat(450) }).counter).toEqual({
      text: '50 left',
      tone: 'warning',
      icon: 'alert',
    });
    expect(composerView({ ...base, input: 'a'.repeat(500) }).sendDisabled).toBe(
      false,
    );
    const over = composerView({ ...base, input: 'a'.repeat(512) });
    expect(over.sendDisabled).toBe(true);
    expect(over.counter).toEqual({
      text: '12 over the limit',
      tone: 'danger',
      icon: 'alertCircle',
    });
    expect(over.helper.text).toBe(
      'Send is off: shorten your question to 500 characters.',
    );
  });

  it('turns send into stop while an answer runs, and keeps stop enabled', () => {
    const v = composerView({ ...base, input: '', busy: true });
    expect(v.sendMode).toBe('stop');
    expect(v.sendDisabled).toBe(false);
    expect(v.sendLabel).toBe('Stop the answer (Esc)');
  });

  it.each([
    ['empty input', { input: '   ' }],
    [
      'no questions left',
      { quota: { left: 0, limit: 3, principal: 'guest' as const } },
    ],
    ['assistant off', { chatEnabled: false }],
    ['rate limit', { inline: { kind: 'rate' as const, seconds: 9 } }],
    ['guest check running', { check: 'checking' as const }],
  ])('disables send for %s', (_name, override) => {
    expect(composerView({ ...base, ...override }).sendDisabled).toBe(true);
  });

  it('warns on the last question and explains the rate countdown', () => {
    expect(
      composerView({
        ...base,
        quota: { left: 1, limit: 3, principal: 'guest' },
      }).helper,
    ).toEqual({
      text: '1 question left today',
      tone: 'warning',
      icon: 'alert',
    });
    expect(
      composerView({ ...base, inline: { kind: 'rate', seconds: 9 } }).helper
        .text,
    ).toBe('Send is off for 9 s.');
  });

  it('shortens the helper on compact layouts', () => {
    expect(
      composerView({ ...base, input: '', compact: true }).helper.text,
    ).toBe('Type a question to send.');
    expect(composerView({ ...base, compact: true }).helper.text).toBe('');
  });
});

describe('meterView', () => {
  it('colors by remaining questions', () => {
    expect(meterView({ left: 3, limit: 3, principal: 'guest' })).toMatchObject({
      tone: 'normal',
      icon: null,
      percent: 100,
    });
    expect(meterView({ left: 1, limit: 3, principal: 'guest' })).toMatchObject({
      tone: 'warning',
      icon: 'alert',
    });
    expect(meterView({ left: 0, limit: 10, principal: 'user' })).toMatchObject({
      tone: 'danger',
      icon: 'alertCircle',
      text: '0 of 10 questions left today',
    });
  });
});

describe('limitView', () => {
  const now = new Date('2026-10-04T15:30:00Z');
  const guest = { status: 'guest' } as const;

  it('shows nothing while questions remain', () => {
    expect(
      limitView({ left: 2, limit: 3, principal: 'guest' }, guest, false, now),
    ).toBeNull();
  });

  it('offers sign-in only to guests', () => {
    const q = { left: 0, limit: 3, principal: 'guest' } as const;
    expect(limitView(q, guest, false, now)?.signInCta).toBe(true);
    expect(
      limitView(
        { ...q, limit: 10, principal: 'user' },
        { status: 'signed-in' },
        false,
        now,
      )?.signInCta,
    ).toBe(false);
  });

  it('shows the site-wide limit even when the visitor has questions left', () => {
    const v = limitView(
      { left: 2, limit: 3, principal: 'guest' },
      guest,
      true,
      now,
    );
    expect(v?.title).toBe('Daily limit reached');
    expect(v?.signInCta).toBe(false);
  });

  it('resets at the next UTC midnight', () => {
    const expected = new Date('2026-10-05T00:00:00Z').toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(resetLabel(now)).toBe(expected);
  });
});
