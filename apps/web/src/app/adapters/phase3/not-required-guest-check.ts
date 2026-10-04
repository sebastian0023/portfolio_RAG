import type {
  GuestCheckPort,
  GuestCheckResult,
} from '../../core/ports/guest-check-port';

// Phase 3 verifies nothing, and says so: `required` is false, so the UI never shows "check passed" for a
// check that did not happen. The abuse brake in this phase is the server-side rate limits and the daily cap.
// Replaced by the Turnstile adapter in P4-03.
export class NotRequiredGuestCheck implements GuestCheckPort {
  readonly required = false;

  verify(): Promise<GuestCheckResult> {
    return Promise.resolve('passed');
  }
}
