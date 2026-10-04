import {
  parseRuntimeConfig,
  type ConfigIssue,
  type RuntimeConfig,
} from './runtime-config.js';

export type ConfigState =
  | { readonly status: 'ready'; readonly config: RuntimeConfig }
  | { readonly status: 'unavailable'; readonly issues: readonly ConfigIssue[] };

// Port implemented by an SSM adapter in Phase 3. Core never sees an SDK.
export interface ConfigSource {
  load(): Promise<Readonly<Partial<Record<string, string | undefined>>>>;
}

export interface CachedConfigOptions {
  // How long a good config is trusted (ADR-027: short and bounded).
  readonly ttlMs?: number;
  // How long a failure is remembered, so an SSM outage is not hammered by every request.
  readonly failureTtlMs?: number;
  readonly now?: () => number;
}

export const DEFAULT_TTL_MS = 30_000;
export const DEFAULT_FAILURE_TTL_MS = 5_000;
const MIN_TTL_MS = 1_000;
const MAX_TTL_MS = 300_000;

function bounded(value: number | undefined, fallback: number): number {
  const chosen = value ?? fallback;
  if (!Number.isFinite(chosen) || chosen < MIN_TTL_MS || chosen > MAX_TTL_MS) {
    throw new RangeError(
      `cache ttl must be between ${MIN_TTL_MS} and ${MAX_TTL_MS} ms`,
    );
  }
  return chosen;
}

// Caches validated config. A refresh failure or an invalid value never reuses the previous config
// after expiry: callers see 'unavailable' and must reject the request before any paid call.
export class CachedConfig {
  private readonly ttlMs: number;
  private readonly failureTtlMs: number;
  private readonly now: () => number;
  private cached: { state: ConfigState; expiresAt: number } | undefined;
  private inflight: Promise<ConfigState> | undefined;

  constructor(
    private readonly source: ConfigSource,
    options: CachedConfigOptions = {},
  ) {
    this.ttlMs = bounded(options.ttlMs, DEFAULT_TTL_MS);
    this.failureTtlMs = bounded(options.failureTtlMs, DEFAULT_FAILURE_TTL_MS);
    this.now = options.now ?? Date.now;
  }

  get(): Promise<ConfigState> {
    if (this.cached && this.now() < this.cached.expiresAt) {
      return Promise.resolve(this.cached.state);
    }
    // Concurrent callers share one refresh instead of each hitting the source.
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async refresh(): Promise<ConfigState> {
    let state: ConfigState;
    try {
      const result = parseRuntimeConfig(await this.source.load());
      state = result.ok
        ? { status: 'ready', config: result.config }
        : { status: 'unavailable', issues: result.issues };
    } catch {
      state = {
        status: 'unavailable',
        issues: [
          {
            parameter: '*',
            problem: 'unreadable',
            detail: 'config source failed',
          },
        ],
      };
    }
    const ttl = state.status === 'ready' ? this.ttlMs : this.failureTtlMs;
    this.cached = { state, expiresAt: this.now() + ttl };
    return state;
  }
}

// Chat is allowed only when config is ready AND the flag is on. Everything else fails closed.
export function isChatAllowed(state: ConfigState): boolean {
  return state.status === 'ready' && state.config.chatEnabled;
}
