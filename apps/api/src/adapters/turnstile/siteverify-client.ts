import { z } from 'zod';
import type {
  TurnstileCheck,
  TurnstileOutcome,
  TurnstileVerifier,
} from '../../core/guest/turnstile-port.js';

export const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_ACTION = 'chat';
const TIMEOUT_MS = 3000;

const answerSchema = z.looseObject({
  success: z.boolean(),
  action: z.string().optional(),
  'error-codes': z.array(z.string()).optional(),
});

// Error codes that say the check could not be done, not that the visitor failed it: our secret is wrong or
// Cloudflare had an internal problem. They must not read as a failed visitor, and they refuse the request.
const PLATFORM_ERRORS: ReadonlySet<string> = new Set([
  'missing-input-secret',
  'invalid-input-secret',
  'internal-error',
  'bad-request',
]);

export type FetchLike = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

// Server-side Turnstile check (ADR-052). The token is single-use and valid for five minutes, and Cloudflare
// enforces that. We additionally require the action the widget was rendered with, so a token minted for a
// different form on the same site cannot be used here. Error codes and the token are never logged.
export function createSiteverifyClient(
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): TurnstileVerifier {
  return {
    async verify(check: TurnstileCheck): Promise<TurnstileOutcome> {
      try {
        const response = await fetchImpl(SITEVERIFY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            secret: check.secret,
            response: check.token,
            remoteip: check.remoteIp,
            idempotency_key: check.idempotencyKey,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return 'unavailable';
        const parsed = answerSchema.safeParse(await response.json());
        if (!parsed.success) return 'unavailable';
        const answer = parsed.data;
        if (answer.success) {
          return answer.action === TURNSTILE_ACTION ? 'passed' : 'failed';
        }
        const codes = answer['error-codes'] ?? [];
        return codes.some((code) => PLATFORM_ERRORS.has(code))
          ? 'unavailable'
          : 'failed';
      } catch {
        return 'unavailable';
      }
    },
  };
}
