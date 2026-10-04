import { MAX_QUESTION_LENGTH, type QuotaState } from '@portfolio/shared';
import type { InlineAlert } from './chat-state';
import { GUEST_LIMIT, SIGNED_IN_LIMIT, type CheckState } from './chat-state';
import type { SessionInfo } from '../ports/session-port';

// Pure derivations of what the composer, meter, and limit card show. Copy follows the design's
// state table; components bind to these and hold no rules of their own.

export type Tone = 'normal' | 'warning' | 'danger';
export type ToneIcon = 'alert' | 'alertCircle' | null;

export const NEAR_LIMIT_FROM = 450;

export interface MeterView {
  readonly left: number;
  readonly limit: number;
  readonly text: string;
  readonly percent: number;
  readonly tone: Tone;
  readonly icon: ToneIcon;
}

export function meterView(quota: QuotaState): MeterView {
  const tone: Tone =
    quota.left === 0 ? 'danger' : quota.left === 1 ? 'warning' : 'normal';
  return {
    left: quota.left,
    limit: quota.limit,
    text: `${quota.left} of ${quota.limit} questions left today`,
    percent: (quota.left / quota.limit) * 100,
    tone,
    icon:
      tone === 'danger' ? 'alertCircle' : tone === 'warning' ? 'alert' : null,
  };
}

export interface LimitView {
  readonly title: string;
  readonly text: string;
  readonly signInCta: boolean;
}

// Quota windows are UTC calendar days (abuse-budgets.md), so the reset moment is the next UTC midnight.
export function resetLabel(now: Date): string {
  const reset = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return reset.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function limitView(
  quota: QuotaState,
  session: SessionInfo,
  siteLimit: boolean,
  now: Date,
): LimitView | null {
  const reset = resetLabel(now);
  if (siteLimit) {
    return {
      title: 'Daily limit reached',
      text: `The assistant has answered all it can for today. It resets at ${reset}. The rest of this page still works.`,
      signInCta: false,
    };
  }
  if (quota.left > 0) return null;
  if (session.status === 'signed-in') {
    return {
      title: 'No questions left today',
      text: `You've used today's ${SIGNED_IN_LIMIT} questions. They reset at ${reset}.`,
      signInCta: false,
    };
  }
  return {
    title: 'No questions left today',
    text: `You've used today's ${GUEST_LIMIT} questions. Sign in to get ${SIGNED_IN_LIMIT} a day, or come back after ${reset}.`,
    signInCta: true,
  };
}

export interface ComposerInput {
  readonly input: string;
  readonly busy: boolean;
  readonly chatEnabled: boolean;
  readonly quota: QuotaState;
  readonly inline: InlineAlert | null;
  readonly check: CheckState;
  readonly compact: boolean;
}

export interface ComposerView {
  readonly helper: {
    readonly text: string;
    readonly tone: Tone;
    readonly icon: ToneIcon;
  };
  readonly counter: {
    readonly text: string;
    readonly tone: Tone;
    readonly icon: ToneIcon;
  };
  readonly sendMode: 'send' | 'stop';
  readonly sendDisabled: boolean;
  readonly sendLabel: string;
  readonly textareaDisabled: boolean;
  readonly overLimit: boolean;
}

export function composerView(state: ComposerInput): ComposerView {
  const length = state.input.length;
  const rate = state.inline?.kind === 'rate' ? state.inline : null;
  const overLimit = length > MAX_QUESTION_LENGTH;

  let helper: ComposerView['helper'] = {
    text: state.compact
      ? length
        ? ''
        : 'Type a question to send.'
      : 'Enter to send · Shift + Enter for a new line',
    tone: 'normal',
    icon: null,
  };
  if (!state.chatEnabled) {
    helper = {
      text: 'Sending is off: the assistant is unavailable right now.',
      tone: 'normal',
      icon: null,
    };
  } else if (overLimit) {
    helper = {
      text: `Send is off: shorten your question to ${MAX_QUESTION_LENGTH} characters.`,
      tone: 'danger',
      icon: 'alertCircle',
    };
  } else if (state.busy) {
    helper = {
      text: 'You can send your next question when this answer ends. Esc stops it.',
      tone: 'normal',
      icon: null,
    };
  } else if (rate) {
    helper = {
      text: `Send is off for ${rate.seconds} s.`,
      tone: 'normal',
      icon: null,
    };
  } else if (state.check === 'checking') {
    helper = {
      text: 'Your question will send after the quick check.',
      tone: 'normal',
      icon: null,
    };
  } else if (state.quota.left === 1) {
    helper = { text: '1 question left today', tone: 'warning', icon: 'alert' };
  }

  let counter: ComposerView['counter'] = {
    text: `${length} / ${MAX_QUESTION_LENGTH}`,
    tone: 'normal',
    icon: null,
  };
  if (overLimit) {
    counter = {
      text: `${length - MAX_QUESTION_LENGTH} over the limit`,
      tone: 'danger',
      icon: 'alertCircle',
    };
  } else if (length >= NEAR_LIMIT_FROM) {
    counter = {
      text: `${MAX_QUESTION_LENGTH - length} left`,
      tone: 'warning',
      icon: 'alert',
    };
  }

  const sendDisabled = state.busy
    ? false
    : !state.input.trim() ||
      overLimit ||
      !state.chatEnabled ||
      state.quota.left <= 0 ||
      rate !== null ||
      state.check === 'checking';

  return {
    helper,
    counter,
    sendMode: state.busy ? 'stop' : 'send',
    sendDisabled,
    sendLabel: state.busy ? 'Stop the answer (Esc)' : 'Send question',
    textareaDisabled: !state.chatEnabled,
    overLimit,
  };
}
