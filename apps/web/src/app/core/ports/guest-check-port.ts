export type GuestCheckResult = 'passed' | 'failed';

// The bot check shown to guests before their first question (Turnstile in Phase 4).
export interface GuestCheckPort {
  verify(signal?: AbortSignal): Promise<GuestCheckResult>;
}
