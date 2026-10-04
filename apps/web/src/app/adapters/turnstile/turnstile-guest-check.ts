import { GUEST_PASS_PATH } from '@portfolio/shared';
import { guestPassResponseSchema } from '@portfolio/shared/chat-stream-schema';
import type {
  GuestCheckPort,
  GuestCheckResult,
} from '../../core/ports/guest-check-port';
import { sha256Hex } from '../http/sha256';

// The slice of Cloudflare's widget API this adapter uses.
export interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      execution: 'execute';
      appearance: 'interaction-only';
      callback: (token: string) => void;
      'error-callback': () => void;
      'expired-callback': () => void;
    },
  ): string;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

export const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const SLOT_ID = 'guest-check-slot';
export const TURNSTILE_ACTION = 'chat';

// A pass that runs out in under a minute is treated as already gone, so a question never leaves with a pass
// that expires on the way.
const MARGIN_MS = 60_000;
// An interactive challenge may need the visitor, so give it time before giving up.
const TOKEN_TIMEOUT_MS = 60_000;

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Loads Cloudflare's script once, on first use. The origin is the only remote one the CSP allows.
export function loadTurnstile(doc: Document = document): Promise<TurnstileApi> {
  if (doc.defaultView?.turnstile)
    return Promise.resolve(doc.defaultView.turnstile);
  return new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.onload = (): void => {
      const api = doc.defaultView?.turnstile;
      if (api) resolve(api);
      else reject(new Error('The bot check did not load.'));
    };
    script.onerror = (): void =>
      reject(new Error('The bot check did not load.'));
    doc.head.appendChild(script);
  });
}

export interface TurnstileGuestCheckDeps {
  readonly siteKey: string;
  readonly loadApi?: () => Promise<TurnstileApi>;
  readonly slot?: () => HTMLElement | null;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly tokenTimeoutMs?: number;
}

// Cloudflare Turnstile guest check (ADR-052). It trades a fresh Turnstile token for a one-hour guest pass from
// the API and keeps the pass in memory only. The widget stays invisible unless Cloudflare wants an interaction.
export class TurnstileGuestCheck implements GuestCheckPort {
  private pass: {
    readonly value: string;
    readonly expiresAtMs: number;
  } | null = null;
  private widget: { api: TurnstileApi; id: string } | null = null;
  private pending: {
    resolve: (token: string) => void;
    reject: (error: Error) => void;
  } | null = null;
  private inflight: Promise<GuestCheckResult> | null = null;

  private readonly loadApi: () => Promise<TurnstileApi>;
  private readonly slot: () => HTMLElement | null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly tokenTimeoutMs: number;

  constructor(private readonly deps: TurnstileGuestCheckDeps) {
    this.loadApi = deps.loadApi ?? (() => loadTurnstile());
    this.slot = deps.slot ?? (() => document.getElementById(SLOT_ID));
    this.fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args));
    this.now = deps.now ?? Date.now;
    this.tokenTimeoutMs = deps.tokenTimeoutMs ?? TOKEN_TIMEOUT_MS;
  }

  isReady(): boolean {
    return this.getPass() !== null;
  }

  // The usable pass for the transport, or null.
  getPass(): string | null {
    return this.pass && this.pass.expiresAtMs - this.now() > MARGIN_MS
      ? this.pass.value
      : null;
  }

  invalidate(): void {
    this.pass = null;
  }

  // Concurrent callers share one run: a token is single-use, so two runs would waste one.
  verify(signal?: AbortSignal): Promise<GuestCheckResult> {
    this.inflight ??= this.run(signal).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async run(signal?: AbortSignal): Promise<GuestCheckResult> {
    try {
      const token = await this.token(signal);
      const body = new TextEncoder().encode(JSON.stringify({ token }));
      const response = await this.fetchImpl(GUEST_PASS_PATH, {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'x-amz-content-sha256': await sha256Hex(body),
          accept: 'application/json',
        },
        ...(signal ? { signal } : {}),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      });
      const parsed = guestPassResponseSchema.safeParse(await response.json());
      if (response.ok && parsed.success && 'pass' in parsed.data) {
        this.pass = {
          value: parsed.data.pass,
          expiresAtMs: parsed.data.expiresAt * 1000,
        };
        return 'passed';
      }
      return 'failed';
    } catch {
      // Cloudflare, the network, or the API failing all read as "could not verify". Nothing is thrown.
      return 'failed';
    } finally {
      this.resetWidget();
    }
  }

  // Runs the widget and resolves with a fresh token. The widget renders once and is reset for each run.
  private async token(signal?: AbortSignal): Promise<string> {
    const api = await this.loadApi();
    if (!this.widget) {
      const container = this.slot();
      if (!container)
        throw new Error('There is no place to show the bot check.');
      this.widget = {
        api,
        id: api.render(container, {
          sitekey: this.deps.siteKey,
          action: TURNSTILE_ACTION,
          execution: 'execute',
          appearance: 'interaction-only',
          callback: (token) => this.pending?.resolve(token),
          'error-callback': () =>
            this.pending?.reject(new Error('widget error')),
          'expired-callback': () =>
            this.pending?.reject(new Error('token expired')),
        }),
      };
    }
    const widget = this.widget;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The bot check timed out.')),
        this.tokenTimeoutMs,
      );
      const finish = (): void => {
        clearTimeout(timer);
        this.pending = null;
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        finish();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      this.pending = {
        resolve: (token) => {
          finish();
          resolve(token);
        },
        reject: (error) => {
          finish();
          reject(error);
        },
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      widget.api.execute(widget.id);
    });
  }

  private resetWidget(): void {
    if (this.widget) this.widget.api.reset(this.widget.id);
  }
}
