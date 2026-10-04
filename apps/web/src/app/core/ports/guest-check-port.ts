export type GuestCheckResult = 'passed' | 'failed';

// The bot check shown to guests (Turnstile, ADR-052). One pass lasts an hour, so the check does not run before
// every question; it runs when no usable pass is held.
export interface GuestCheckPort {
  // True while a pass is held that will not run out within the next minute.
  isReady(): boolean;
  // Runs the check and obtains a pass. Resolves 'failed' for any problem; it never throws.
  verify(signal?: AbortSignal): Promise<GuestCheckResult>;
  // Forgets the pass, for when the server refused it.
  invalidate(): void;
}
