import { TestBed } from '@angular/core/testing';
import type {
  ChatRequest,
  ChatStreamEvent,
  QuotaState,
  SourceCitation,
} from '@portfolio/shared';
import type { ChatTransport } from '../ports/chat-transport';
import type {
  GuestCheckPort,
  GuestCheckResult,
} from '../ports/guest-check-port';
import type { SessionInfo, SessionPort } from '../ports/session-port';
import {
  CHAT_TRANSPORT,
  GUEST_CHECK_PORT,
  SESSION_PORT,
} from '../ports/tokens';
import { CHAT_SEED } from './chat-seed';
import type { ChatSeed } from './chat-state';
import { ChatFacade } from './chat-facade';

type Item =
  ChatStreamEvent | { readonly throw: unknown } | { readonly end: true };

// One transport call. Tests push events by hand, so ordering and races are explicit.
export class Channel {
  private queue: Item[] = [];
  private wake: (() => void) | null = null;
  constructor(
    readonly request: ChatRequest,
    signal: AbortSignal,
  ) {
    signal.addEventListener('abort', () =>
      this.push({ throw: new DOMException('Aborted', 'AbortError') }),
    );
  }
  push(item: Item): void {
    this.queue.push(item);
    this.wake?.();
  }
  emit(event: ChatStreamEvent): void {
    this.push(event);
  }
  fail(error: unknown): void {
    this.push({ throw: error });
  }
  end(): void {
    this.push({ end: true });
  }
  async *stream(): AsyncGenerator<ChatStreamEvent> {
    for (;;) {
      while (!this.queue.length)
        await new Promise<void>((r) => (this.wake = r));
      const item = this.queue.shift()!;
      if ('end' in item) return;
      if ('throw' in item) throw item.throw;
      yield item;
    }
  }
}

export class ScriptedTransport implements ChatTransport {
  readonly calls: Channel[] = [];
  send(
    request: ChatRequest,
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamEvent> {
    const channel = new Channel(request, signal);
    this.calls.push(channel);
    return channel.stream();
  }
  get last(): Channel {
    return this.calls[this.calls.length - 1]!;
  }
}

export class FakeSession implements SessionPort {
  signInAvailable = true;
  info: SessionInfo = { status: 'guest' };
  nextSignIn: SessionInfo | Error = { status: 'signed-in', displayName: 'Ada' };
  read(): SessionInfo {
    return this.info;
  }
  async beginSignIn(): Promise<SessionInfo> {
    if (this.nextSignIn instanceof Error) throw this.nextSignIn;
    this.info = this.nextSignIn;
    return this.info;
  }
  signOut(): void {
    this.info = { status: 'guest' };
  }
}

export class FakeGuestCheck implements GuestCheckPort {
  required = true;
  results: GuestCheckResult[] = [];
  calls = 0;
  // Set to hold the check open until the test releases it.
  gate: Promise<void> | null = null;
  async verify(): Promise<GuestCheckResult> {
    this.calls++;
    await this.gate;
    return this.results.shift() ?? 'passed';
  }
}

export interface Harness {
  facade: ChatFacade;
  transport: ScriptedTransport;
  session: FakeSession;
  guestCheck: FakeGuestCheck;
}

export function setup(seed: ChatSeed = { verified: true }): Harness {
  const transport = new ScriptedTransport();
  const session = new FakeSession();
  const guestCheck = new FakeGuestCheck();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: CHAT_TRANSPORT, useValue: transport },
      { provide: SESSION_PORT, useValue: session },
      { provide: GUEST_CHECK_PORT, useValue: guestCheck },
      { provide: CHAT_SEED, useValue: seed },
    ],
  });
  return { facade: TestBed.inject(ChatFacade), transport, session, guestCheck };
}

export const quota = (
  left: number,
  limit = 3,
  principal: QuotaState['principal'] = 'guest',
): QuotaState => ({
  left,
  limit,
  principal,
});

export const source = (n: number): SourceCitation => ({
  n,
  chunkId: `s${n}#0`,
  sourceId: `s${n}`,
  title: `Source ${n}`,
  section: 'Section',
  path: `knowledge/s${n}.md`,
  updated: '2026-09-12',
  excerpt: 'Cited sentence. Other sentence.',
  highlights: [{ start: 0, end: 15 }],
});
