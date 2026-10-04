import type { ChatErrorCode } from '@portfolio/shared';

// What the next call to the mock transport should do. 'ok' is the default.
export type MockOutcome =
  | 'ok'
  | 'network'
  | 'empty'
  | 'hang'
  | { readonly error: ChatErrorCode; readonly retryAfterSeconds?: number }
  | { readonly interruptAfter: number }
  | { readonly hangAfter: number };

export interface MockConfig {
  enabled: boolean;
  siteLimited: boolean;
  guestLeft: number;
  userLeft: number;
  guestLimit: number;
  userLimit: number;
  // Consumed one per transport call, front first.
  outcomes: MockOutcome[];
  // Consumed one per guest check.
  checks: ('passed' | 'failed')[];
  thinkingMs: number;
  tokenMs: number;
  checkMs: number;
  signInMs: number;
}

export function createMockConfig(
  overrides: Partial<MockConfig> = {},
): MockConfig {
  return {
    enabled: true,
    siteLimited: false,
    guestLeft: 3,
    userLeft: 10,
    guestLimit: 3,
    userLimit: 10,
    outcomes: [],
    checks: [],
    thinkingMs: 900,
    tokenMs: 55,
    checkMs: 1500,
    signInMs: 1800,
    ...overrides,
  };
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException('Aborted', 'AbortError'));
    const onAbort = (): void => {
      clearTimeout(handle);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const handle = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
