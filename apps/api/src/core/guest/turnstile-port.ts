// Server-side check of a Turnstile token (ADR-052). Implemented by the siteverify adapter.
export interface TurnstileCheck {
  readonly secret: string;
  readonly token: string;
  // The viewer's own address, from the trusted edge header.
  readonly remoteIp: string;
  // Lets Cloudflare dedupe a retry of the same request.
  readonly idempotencyKey: string;
}

// passed: a real, fresh, unused token for this site. failed: Cloudflare refused it (bad, expired, reused).
// unavailable: the check could not be completed (timeout, outage, bad answer, misconfigured secret), which
// refuses the request without blaming the visitor.
export type TurnstileOutcome = 'passed' | 'failed' | 'unavailable';

export interface TurnstileVerifier {
  verify(check: TurnstileCheck): Promise<TurnstileOutcome>;
}
