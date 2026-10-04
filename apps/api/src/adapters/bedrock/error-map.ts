import type { LLMError, LLMStopReason } from '@portfolio/shared';

// SDK errors become provider-neutral codes. Only the error name is read: raw provider messages can contain
// request details and are never forwarded or logged (ADR-028).
const BY_NAME: Readonly<Record<string, LLMError>> = {
  ThrottlingException: { code: 'throttled', retryable: true },
  ServiceQuotaExceededException: { code: 'throttled', retryable: true },
  ServiceUnavailableException: { code: 'unavailable', retryable: true },
  ModelNotReadyException: { code: 'unavailable', retryable: true },
  ModelTimeoutException: { code: 'unavailable', retryable: true },
  InternalServerException: { code: 'unavailable', retryable: true },
  ModelErrorException: { code: 'unavailable', retryable: true },
  ModelStreamErrorException: { code: 'unavailable', retryable: true },
  // The budget kill switch denies the call with AccessDenied, which must read as an outage, not a bug.
  AccessDeniedException: { code: 'unavailable', retryable: false },
  ResourceNotFoundException: { code: 'unavailable', retryable: false },
  ValidationException: { code: 'invalid_request', retryable: false },
};

export function mapSdkError(error: unknown, signal?: AbortSignal): LLMError {
  if (signal?.aborted) return { code: 'cancelled', retryable: false };
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  if (name === 'AbortError') return { code: 'cancelled', retryable: false };
  return BY_NAME[name] ?? { code: 'internal', retryable: false };
}

// In-stream exception members of a ConverseStream event, by member name.
export const STREAM_EXCEPTIONS: Readonly<Record<string, string>> = {
  internalServerException: 'InternalServerException',
  modelStreamErrorException: 'ModelStreamErrorException',
  validationException: 'ValidationException',
  throttlingException: 'ThrottlingException',
  serviceUnavailableException: 'ServiceUnavailableException',
};

export type StopOutcome =
  | { readonly kind: 'done'; readonly stopReason: LLMStopReason }
  | { readonly kind: 'error'; readonly error: LLMError };

export function mapStopReason(reason: string): StopOutcome {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return { kind: 'done', stopReason: 'end' };
    case 'max_tokens':
      return { kind: 'done', stopReason: 'max_tokens' };
    case 'content_filtered':
    case 'guardrail_intervened':
      return {
        kind: 'error',
        error: { code: 'content_filtered', retryable: false },
      };
    default:
      // tool_use and anything new: this adapter sends no tools, so it is unexpected.
      return { kind: 'error', error: { code: 'internal', retryable: false } };
  }
}
