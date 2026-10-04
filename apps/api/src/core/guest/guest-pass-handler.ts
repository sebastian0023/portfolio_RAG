import { z } from 'zod';
import type { ChatErrorCode } from '@portfolio/shared';
import {
  runAdmission,
  type AdmissionContext,
  type AdmissionStage,
} from '../chat/admission.js';
import { reject, statusForCode } from '../chat/rejection.js';
import { fingerprint } from '../admission/windows.js';
import type { Logger } from '../ports/logger.js';
import { issuePass } from './guest-pass.js';
import type { CachedSecrets } from './secrets.js';
import type { TurnstileVerifier } from './turnstile-port.js';

// Body of POST /api/guest-pass. Turnstile tokens are at most 2,048 characters.
const MAX_TOKEN_CHARS = 2048;
const bodySchema = z.strictObject({
  token: z.string().min(1).max(MAX_TOKEN_CHARS),
});

// Parses the body into ctx.guestToken. Runs after the shared content-type and byte-cap stages.
export const guestTokenStage: AdmissionStage = (ctx) => {
  let json: unknown;
  try {
    json = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(ctx.bodyBytes),
    );
  } catch {
    return Promise.resolve(reject('unavailable', { status: 400 }));
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Promise.resolve(reject('unavailable', { status: 400 }));
  }
  ctx.guestToken = parsed.data.token;
  return Promise.resolve(undefined);
};

export type GuestPassBody =
  | { readonly pass: string; readonly expiresAt: number }
  | { readonly error: ChatErrorCode; readonly retryAfterSeconds?: number };

export interface GuestPassResponse {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  readonly body: GuestPassBody;
}

export type GuestPassHandler = (
  ctx: AdmissionContext,
  requestId: string,
) => Promise<GuestPassResponse>;

export interface GuestPassHandlerDeps {
  readonly stages: readonly AdmissionStage[];
  readonly secrets: CachedSecrets;
  readonly verifier: TurnstileVerifier;
  readonly logger: Logger;
  readonly now?: () => number;
}

const failure = (
  status: number,
  error: ChatErrorCode,
  retryAfterSeconds?: number,
): GuestPassResponse => ({
  status,
  ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  body: {
    error,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  },
});

// Trades a Turnstile token for a one-hour guest pass (ADR-052). The same cheap stages as chat run first
// (content type, size, schema, config, trusted IP, per-minute rate, chat_enabled), so Cloudflare is only
// called for a well-formed request that passed the rate limit. Every uncertain outcome refuses.
export function createGuestPassHandler(
  deps: GuestPassHandlerDeps,
): GuestPassHandler {
  const now = deps.now ?? Date.now;

  return async (ctx, requestId) => {
    const started = now();
    const log = (
      outcome: 'completed' | 'rejected' | 'failed',
      status: number,
      errorCode?: string,
    ): void =>
      deps.logger.log({
        requestId,
        stage: 'guest_pass',
        outcome,
        status,
        ...(errorCode === undefined ? {} : { errorCode }),
        latencyMs: now() - started,
      });

    const rejection = await runAdmission(deps.stages, ctx);
    if (rejection) {
      log('rejected', rejection.status, rejection.code);
      return failure(
        rejection.status,
        rejection.code,
        rejection.retryAfterSeconds,
      );
    }

    const { guestToken, viewerIp, clientKey } = ctx;
    const secrets = await deps.secrets.get();
    if (!guestToken || !viewerIp || !clientKey || secrets.status !== 'ready') {
      log('failed', 503, 'unavailable');
      return failure(statusForCode('unavailable'), 'unavailable');
    }

    const outcome = await deps.verifier.verify({
      secret: secrets.secrets.turnstileSecret,
      token: guestToken,
      remoteIp: viewerIp,
      idempotencyKey: requestId,
    });
    if (outcome === 'unavailable') {
      log('failed', 503, 'unavailable');
      return failure(503, 'unavailable');
    }
    if (outcome === 'failed') {
      log('rejected', 403, 'guest_check_failed');
      return failure(403, 'guest_check_failed');
    }

    const issued = issuePass(
      secrets.secrets.guestPassKey,
      fingerprint(clientKey),
      now(),
    );
    log('completed', 200);
    return { status: 200, body: issued };
  };
}
