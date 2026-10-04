import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  MAX_HISTORY_TURNS,
  MAX_QUESTION_LENGTH,
  type ChatStreamError,
  type ChatStreamEvent,
  type ChatTurn,
  type QuotaState,
} from '@portfolio/shared';
import { NetworkError } from '../ports/chat-transport';
import type { AuthProvider, SessionInfo } from '../ports/session-port';
import {
  CHAT_TRANSPORT,
  GUEST_CHECK_PORT,
  SESSION_PORT,
} from '../ports/tokens';
import { parseAnswer, plainAnswer } from './answer-parser';
import {
  GUEST_LIMIT,
  SIGNED_IN_LIMIT,
  type AssistantMessage,
  type ChatMessage,
  type ChatPhase,
  type ChatSeed,
  type CheckState,
  type DialogKind,
  type InlineAlert,
  type Toast,
  type ToastKind,
  type ViewerRef,
} from './chat-state';
import { CHAT_SEED } from './chat-seed';

const PASSED_HOLD_MS = 600;
const TOAST_MS = 5000;
const DEFAULT_RETRY_SECONDS = 30;

function nowLabel(): string {
  return new Date().toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

// Owns chat state and coordinates the transport, session, and guest check (ADR-002). Components
// read signals and call methods; they never see a port.
@Injectable({ providedIn: 'root' })
export class ChatFacade {
  private readonly transport = inject(CHAT_TRANSPORT);
  private readonly sessionPort = inject(SESSION_PORT);
  private readonly guestCheck = inject(GUEST_CHECK_PORT);
  private readonly seed: ChatSeed = inject(CHAT_SEED, { optional: true }) ?? {};

  private readonly _messages = signal<readonly ChatMessage[]>(
    this.seed.messages ?? [],
  );
  private readonly _input = signal(this.seed.input ?? '');
  private readonly _session = signal<SessionInfo>(
    this.seed.session ?? this.sessionPort.read(),
  );
  private readonly _quota = signal<QuotaState>(
    this.seed.quota ?? this.defaultQuota(this._session()),
  );
  private readonly _verified = signal(this.seed.verified ?? false);
  private readonly _check = signal<CheckState>(this.seed.check ?? 'idle');
  private readonly _inline = signal<InlineAlert | null>(
    this.seed.inline ?? null,
  );
  private readonly _dialog = signal<DialogKind | null>(
    this.seed.dialog ?? null,
  );
  private readonly _viewer = signal<ViewerRef | null>(this.seed.viewer ?? null);
  private readonly _redirecting = signal(this.seed.redirecting ?? false);
  private readonly _chatEnabled = signal(this.seed.chatEnabled ?? true);
  private readonly _siteLimit = signal(this.seed.siteLimit ?? false);
  private readonly _toasts = signal<readonly Toast[]>(this.seed.toasts ?? []);
  private readonly _live = signal('');
  private readonly _alert = signal('');

  readonly messages = this._messages.asReadonly();
  readonly input = this._input.asReadonly();
  readonly session = this._session.asReadonly();
  readonly quota = this._quota.asReadonly();
  readonly check = this._check.asReadonly();
  readonly inline = this._inline.asReadonly();
  readonly dialog = this._dialog.asReadonly();
  readonly viewerRef = this._viewer.asReadonly();
  readonly redirecting = this._redirecting.asReadonly();
  readonly chatEnabled = this._chatEnabled.asReadonly();
  readonly siteLimit = this._siteLimit.asReadonly();
  readonly toasts = this._toasts.asReadonly();
  // Polite and assertive live-region text. Updated on phase changes only, never per token.
  readonly liveText = this._live.asReadonly();
  readonly alertText = this._alert.asReadonly();

  readonly lastAssistant = computed(() => {
    const all = this._messages();
    for (let i = all.length - 1; i >= 0; i--) {
      const m = all[i];
      if (m?.role === 'assistant') return m;
    }
    return null;
  });

  readonly busy = computed(() => {
    const status = this.lastAssistant()?.status;
    return (
      status === 'thinking' ||
      status === 'streaming' ||
      this._check() === 'checking'
    );
  });

  readonly phase = computed<ChatPhase>(() => {
    if (this._check() === 'checking') return 'verifying';
    switch (this.lastAssistant()?.status) {
      case 'thinking':
        return 'submitting';
      case 'streaming':
        return 'streaming';
      case 'done':
        return 'complete';
      case 'error':
        return 'error';
      case 'stopped':
        return 'cancelled';
      default:
        return 'idle';
    }
  });

  readonly signInAvailable = this.sessionPort.signInAvailable;
  readonly isSignedIn = computed(() => this._session().status === 'signed-in');
  readonly sessionExpired = computed(
    () => this._session().status === 'expired',
  );
  readonly isEmpty = computed(() => this._messages().length === 0);

  readonly viewer = computed(() => {
    const ref = this._viewer();
    if (!ref) return null;
    const message = this._messages().find((m) => m.id === ref.messageId);
    if (message?.role !== 'assistant') return null;
    const source = message.sources[ref.index];
    if (!source) return null;
    return {
      messageId: message.id,
      source,
      index: ref.index,
      total: message.sources.length,
      hasPrev: ref.index > 0,
      hasNext: ref.index < message.sources.length - 1,
    };
  });

  private nextId =
    Math.max(
      0,
      ...(this.seed.messages ?? []).map((m) => m.id),
      ...(this.seed.toasts ?? []).map((t) => t.id),
    ) + 1;
  private run = 0;
  private checkRun = 0;
  private controller: AbortController | null = null;
  private countdown: ReturnType<typeof setInterval> | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    const inline = this._inline();
    if (inline?.kind === 'rate') this.startCountdown(inline.seconds);
    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  setInput(value: string): void {
    this._input.set(value);
    const inline = this._inline();
    // Editing clears errors that were about the old text.
    if (inline?.kind === 'too_long' || inline?.kind === 'network')
      this._inline.set(null);
  }

  async send(question?: string): Promise<void> {
    const q = (question ?? this._input()).trim();
    if (!q) return;
    if (q.length > MAX_QUESTION_LENGTH) {
      this._inline.set({ kind: 'too_long' });
      this._alert.set(
        `That question is longer than ${MAX_QUESTION_LENGTH} characters.`,
      );
      return;
    }
    if (!this.canSend()) return;
    if (!this.isSignedIn() && !this._verified() && this.guestCheck.required) {
      await this.runGuestCheck(q);
      return;
    }
    await this.dispatch(q);
  }

  async retryCheck(): Promise<void> {
    const q = this._input().trim();
    if (q) await this.runGuestCheck(q);
  }

  retryNetwork(): void {
    this._inline.set(null);
    void this.send();
  }

  // Stop button and Esc. The partial answer stays on screen.
  stop(): void {
    const last = this.lastAssistant();
    if (!last || (last.status !== 'thinking' && last.status !== 'streaming'))
      return;
    this.run++;
    this.controller?.abort();
    this.controller = null;
    this.patch(last.id, { status: 'stopped' });
    this._live.set('Answer stopped');
  }

  plainText(message: AssistantMessage): string {
    return plainAnswer(
      parseAnswer(message.text, {
        citeable: new Set(message.sources.map((s) => s.n)),
        unavailable: this.missing(message),
      }),
    ).trim();
  }

  missing(message: AssistantMessage): ReadonlySet<number> {
    const have = new Set(message.sources.map((s) => s.n));
    return new Set(message.cited.filter((n) => !have.has(n)));
  }

  openViewer(messageId: number, index: number): void {
    this._viewer.set({ messageId, index });
  }

  closeViewer(): void {
    this._viewer.set(null);
  }

  moveViewer(delta: 1 | -1): void {
    const v = this.viewer();
    if (!v) return;
    const next = v.index + delta;
    if (next < 0 || next >= v.total) return;
    this._viewer.set({ messageId: v.messageId, index: next });
  }

  openSignIn(): void {
    this._dialog.set('signin');
  }

  openHow(): void {
    this._dialog.set('how');
  }

  closeDialog(): void {
    this._dialog.set(null);
  }

  async chooseProvider(provider: AuthProvider): Promise<void> {
    this._dialog.set(null);
    this._redirecting.set(true);
    try {
      const info = await this.sessionPort.beginSignIn(provider);
      this._session.set(info);
      this._quota.set({
        left: info.quota?.left ?? SIGNED_IN_LIMIT,
        limit: info.quota?.limit ?? SIGNED_IN_LIMIT,
        principal: 'user',
      });
      this.pushToast('success', `Signed in as ${info.displayName ?? 'you'}`);
    } catch {
      this.pushToast('error', "Couldn't sign in. Try again.");
    } finally {
      this._redirecting.set(false);
    }
  }

  signOut(): void {
    this.sessionPort.signOut();
    this._session.set({ status: 'guest' });
    this._quota.update((q) => ({
      left: Math.min(q.left, GUEST_LIMIT),
      limit: GUEST_LIMIT,
      principal: 'guest',
    }));
  }

  pushToast(kind: ToastKind, text: string): void {
    const id = this.nextId++;
    this._toasts.update((all) => [...all, { id, kind, text }]);
    if (kind !== 'error') this.later(() => this.dismissToast(id), TOAST_MS);
  }

  dismissToast(id: number): void {
    this._toasts.update((all) => all.filter((t) => t.id !== id));
  }

  // --- internals ---

  private canSend(): boolean {
    return !(
      this.busy() ||
      !this._chatEnabled() ||
      this._quota().left <= 0 ||
      this._siteLimit() ||
      this._inline()?.kind === 'rate'
    );
  }

  private defaultQuota(session: SessionInfo): QuotaState {
    return session.status === 'signed-in'
      ? {
          left: session.quota?.left ?? SIGNED_IN_LIMIT,
          limit: SIGNED_IN_LIMIT,
          principal: 'user',
        }
      : { left: GUEST_LIMIT, limit: GUEST_LIMIT, principal: 'guest' };
  }

  private async runGuestCheck(question: string): Promise<void> {
    const id = ++this.checkRun;
    this._input.set(question);
    this._check.set('checking');
    this._live.set('Checking that you are a person');
    let result: Awaited<ReturnType<typeof this.guestCheck.verify>>;
    try {
      result = await this.guestCheck.verify();
    } catch {
      result = 'failed';
    }
    if (id !== this.checkRun) return;
    if (result === 'failed') {
      this._check.set('failed');
      this._alert.set("Couldn't verify you. Try again.");
      return;
    }
    this._check.set('passed');
    await new Promise<void>((resolve) => this.later(resolve, PASSED_HOLD_MS));
    if (id !== this.checkRun) return;
    this._check.set('idle');
    this._verified.set(true);
    await this.dispatch(question);
  }

  private async dispatch(question: string): Promise<void> {
    const quotaBefore = this._quota();
    const history = this.historyFor(this._messages());
    const userId = this.nextId++;
    const botId = this.nextId++;
    const time = nowLabel();
    // Optimistic: both bubbles appear at once; a failure before 'accepted' removes them again.
    this._messages.update((all) => [
      ...all,
      { id: userId, role: 'user', text: question, time },
      {
        id: botId,
        role: 'assistant',
        question,
        status: 'thinking',
        text: '',
        sources: [],
        cited: [],
        coverage: null,
      },
    ]);
    this._input.set('');
    this._inline.set(null);
    this._quota.update((q) => ({ ...q, left: Math.max(0, q.left - 1) }));
    this._live.set('AI assistant is thinking');

    const run = ++this.run;
    const controller = new AbortController();
    this.controller = controller;
    let accepted = false;
    let finished = false;

    const rollback = (): void => {
      this._messages.update((all) =>
        all.filter((m) => m.id !== userId && m.id !== botId),
      );
      this._input.set(question);
      this._quota.set(quotaBefore);
    };

    try {
      for await (const event of this.transport.send(
        { question, history },
        controller.signal,
      )) {
        if (run !== this.run) return;
        if (event.type === 'error') {
          this.onError(event.error, accepted, botId, rollback);
          return;
        }
        accepted = this.onEvent(event, botId) || accepted;
        if (event.type === 'done') finished = true;
      }
      if (run !== this.run || finished) return;
      // The stream ended without 'done' or 'error'.
      this.interrupt(botId);
    } catch (error) {
      if (run !== this.run || isAbort(error)) return;
      if (!accepted && error instanceof NetworkError) {
        rollback();
        this._inline.set({ kind: 'network' });
        this._alert.set(
          "Couldn't send your question. Check your connection and try again.",
        );
        return;
      }
      this.interrupt(botId);
    } finally {
      if (run === this.run) this.controller = null;
    }
  }

  // Returns true once the server has accepted (and counted) the question.
  private onEvent(
    event: Exclude<ChatStreamEvent, { type: 'error' }>,
    botId: number,
  ): boolean {
    switch (event.type) {
      case 'accepted':
        this._quota.set(event.quota);
        return true;
      case 'sources':
        this.patch(botId, { sources: event.sources });
        return false;
      case 'delta': {
        const current = this.find(botId);
        if (!current) return false;
        if (current.status === 'thinking')
          this._live.set('AI assistant is answering');
        this.patch(botId, {
          status: 'streaming',
          text: current.text + event.text,
        });
        return false;
      }
      case 'done': {
        this.patch(botId, {
          status: 'done',
          coverage: event.coverage,
          cited: event.cited,
        });
        const done = this.find(botId);
        if (done)
          this._live.set(`AI assistant answered: ${this.plainText(done)}`);
        return false;
      }
    }
  }

  private onError(
    error: ChatStreamError,
    accepted: boolean,
    botId: number,
    rollback: () => void,
  ): void {
    if (accepted || error.code === 'interrupted') {
      this.interrupt(botId);
      return;
    }
    rollback();
    switch (error.code) {
      case 'too_long':
        this._inline.set({ kind: 'too_long' });
        this._alert.set(
          `That question is longer than ${MAX_QUESTION_LENGTH} characters.`,
        );
        break;
      case 'rate_limited': {
        const seconds = error.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS;
        this.startCountdown(seconds);
        this._alert.set(
          `You're sending questions too quickly. Try again in ${seconds} s.`,
        );
        break;
      }
      case 'quota_exhausted':
        this._quota.update((q) => ({ ...q, left: 0 }));
        break;
      case 'site_limit':
        this._siteLimit.set(true);
        break;
      case 'unavailable':
        this._chatEnabled.set(false);
        this._alert.set('The assistant is unavailable right now.');
        break;
      case 'auth_expired':
        this._session.set({ status: 'expired' });
        this._quota.update((q) => ({
          left: Math.min(q.left, GUEST_LIMIT),
          limit: GUEST_LIMIT,
          principal: 'guest',
        }));
        this._alert.set(
          'Your session ended. Sign in again to keep your higher limit.',
        );
        break;
      case 'guest_check_failed':
        this._verified.set(false);
        this._check.set('failed');
        this._alert.set("Couldn't verify you. Try again.");
        break;
    }
  }

  private interrupt(botId: number): void {
    this.patch(botId, { status: 'error' });
    this._alert.set('The answer was interrupted.');
  }

  private startCountdown(seconds: number): void {
    if (this.countdown) clearInterval(this.countdown);
    this._inline.set({ kind: 'rate', seconds });
    this.countdown = setInterval(() => {
      const current = this._inline();
      if (current?.kind !== 'rate') return this.stopCountdown();
      if (current.seconds <= 1) {
        this.stopCountdown();
        this._inline.set(null);
      } else {
        this._inline.set({ kind: 'rate', seconds: current.seconds - 1 });
      }
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.countdown) clearInterval(this.countdown);
    this.countdown = null;
  }

  private historyFor(all: readonly ChatMessage[]): ChatTurn[] {
    const turns: ChatTurn[] = [];
    for (const m of all) {
      if (m.role === 'user') turns.push({ role: 'user', text: m.text });
      else if (m.status === 'done')
        turns.push({ role: 'assistant', text: this.plainText(m) });
    }
    return turns.slice(-MAX_HISTORY_TURNS);
  }

  private find(id: number): AssistantMessage | undefined {
    const m = this._messages().find((x) => x.id === id);
    return m?.role === 'assistant' ? m : undefined;
  }

  private patch(id: number, changes: Partial<AssistantMessage>): void {
    this._messages.update((all) =>
      all.map((m) =>
        m.id === id && m.role === 'assistant' ? { ...m, ...changes } : m,
      ),
    );
  }

  private later(fn: () => void, ms: number): void {
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      fn();
    }, ms);
    this.timers.add(handle);
  }

  private dispose(): void {
    this.run++;
    this.checkRun++;
    this.controller?.abort();
    this.stopCountdown();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }
}
