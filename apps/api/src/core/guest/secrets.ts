import { z } from 'zod';

// The two secrets of the guest check (ADR-052). They come from SSM SecureStrings whose values the owner sets
// out of band; Terraform only creates them holding the placeholder `unset`.
export interface Secrets {
  readonly turnstileSecret: string;
  readonly guestPassKey: string;
}

export const PLACEHOLDER = 'unset';
export const MIN_KEY_LENGTH = 32;

export interface SecretSource {
  load(): Promise<Readonly<Partial<Record<string, string | undefined>>>>;
}

const secretsSchema = z.strictObject({
  turnstile_secret: z.string().min(8).max(512),
  guest_pass_key: z.string().min(MIN_KEY_LENGTH).max(512),
});

export type SecretsState =
  | { readonly status: 'ready'; readonly secrets: Secrets }
  | { readonly status: 'unavailable' };

// Missing, placeholder, or too-short secrets are unusable. There is no default to fall back to: the guest
// check then refuses and chat stays closed (fail closed).
export function parseSecrets(
  raw: Readonly<Partial<Record<string, string | undefined>>>,
): SecretsState {
  const pick = (name: string): string | undefined => {
    const value = raw[name];
    return value === undefined || value === PLACEHOLDER ? undefined : value;
  };
  const parsed = secretsSchema.safeParse({
    turnstile_secret: pick('turnstile_secret'),
    guest_pass_key: pick('guest_pass_key'),
  });
  return parsed.success
    ? {
        status: 'ready',
        secrets: {
          turnstileSecret: parsed.data.turnstile_secret,
          guestPassKey: parsed.data.guest_pass_key,
        },
      }
    : { status: 'unavailable' };
}

export interface CachedSecretsOptions {
  readonly ttlMs?: number;
  readonly failureTtlMs?: number;
  readonly now?: () => number;
}

// Caches the decrypted secrets briefly so a request does not pay an SSM call, and remembers a failure for a
// few seconds so an outage is not hammered. A failed refresh never reuses the old value after it expires.
export class CachedSecrets {
  private readonly ttlMs: number;
  private readonly failureTtlMs: number;
  private readonly now: () => number;
  private cached: { state: SecretsState; expiresAt: number } | undefined;
  private inflight: Promise<SecretsState> | undefined;

  constructor(
    private readonly source: SecretSource,
    options: CachedSecretsOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 300_000;
    this.failureTtlMs = options.failureTtlMs ?? 5_000;
    this.now = options.now ?? Date.now;
  }

  get(): Promise<SecretsState> {
    if (this.cached && this.now() < this.cached.expiresAt) {
      return Promise.resolve(this.cached.state);
    }
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async refresh(): Promise<SecretsState> {
    let state: SecretsState;
    try {
      state = parseSecrets(await this.source.load());
    } catch {
      state = { status: 'unavailable' };
    }
    this.cached = {
      state,
      expiresAt:
        this.now() +
        (state.status === 'ready' ? this.ttlMs : this.failureTtlMs),
    };
    return state;
  }
}
