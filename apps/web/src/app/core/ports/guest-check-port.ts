export type GuestCheckResult = 'passed' | 'failed';

// The bot check shown to guests before their first question (Turnstile in Phase 4).
export interface GuestCheckPort {
  // False when no check exists yet, so the UI skips the step instead of faking a pass.
  readonly required: boolean;
  verify(signal?: AbortSignal): Promise<GuestCheckResult>;
}
