import type { IndexErrorCode } from '@portfolio/shared';

// SDK errors become provider-neutral codes. Only the error name is read: raw service messages can contain
// request details and are never forwarded or logged (ADR-028). AccessDenied reads as an outage because the
// budget kill switch denies calls that way.
const BY_NAME: Readonly<Record<string, IndexErrorCode>> = {
  NotFoundException: 'not_found',
  TooManyRequestsException: 'throttled',
  ServiceQuotaExceededException: 'throttled',
  ServiceUnavailableException: 'unavailable',
  InternalServerException: 'unavailable',
  RequestTimeoutException: 'unavailable',
  AccessDeniedException: 'unavailable',
  ValidationException: 'invalid_request',
};

export function mapIndexError(
  error: unknown,
  signal?: AbortSignal,
): IndexErrorCode {
  if (signal?.aborted) return 'cancelled';
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  if (name === 'AbortError') return 'cancelled';
  return BY_NAME[name] ?? 'internal';
}
