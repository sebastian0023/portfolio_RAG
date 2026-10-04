import type { ChatErrorCode } from '@portfolio/shared';

// A request refused before any paid call. The HTTP adapter turns it into a non-2xx status carrying
// exactly one SSE error event (ADR-049).
export interface Rejection {
  readonly code: ChatErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;
}

const STATUS_BY_CODE: Readonly<Record<ChatErrorCode, number>> = {
  too_long: 400,
  rate_limited: 429,
  quota_exhausted: 429,
  site_limit: 429,
  unavailable: 503,
  guest_check_failed: 403,
  interrupted: 503,
};

export function statusForCode(code: ChatErrorCode): number {
  return STATUS_BY_CODE[code];
}

export function reject(
  code: ChatErrorCode,
  options: { status?: number; retryAfterSeconds?: number } = {},
): Rejection {
  return {
    code,
    status: options.status ?? statusForCode(code),
    ...(options.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: options.retryAfterSeconds }),
  };
}
