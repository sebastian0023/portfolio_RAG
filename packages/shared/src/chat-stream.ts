import type { Citation } from './index-repository.js';

// Wire contract between the browser and the chat API (ADR-048). The Phase 2 mock transport and the
// Phase 3 Lambda stream the same events, so the UI never learns which one it is talking to.

export const MAX_QUESTION_LENGTH = 500;
export const MAX_EXCERPT_CHARS = 600;
export const MAX_HISTORY_TURNS = 4;

export const CHAT_ERROR_CODES = [
  'too_long',
  'rate_limited',
  'quota_exhausted',
  'site_limit',
  'unavailable',
  'auth_expired',
  'guest_check_failed',
  'interrupted',
] as const;

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];

export type QuotaPrincipal = 'guest' | 'user';

export interface QuotaState {
  readonly left: number;
  readonly limit: number;
  readonly principal: QuotaPrincipal;
}

// Character offsets into `excerpt`; end is exclusive.
export interface HighlightRange {
  readonly start: number;
  readonly end: number;
}

// A retrieved chunk as the visitor sees it. Corpus text is public by policy (ADR-031), so a bounded
// excerpt may travel to the browser; the full chunk and the prompt never do.
export interface SourceCitation extends Citation {
  // The number used by inline markers such as "[1]" in the answer text.
  readonly n: number;
  readonly title: string;
  readonly section: string;
  readonly path: string;
  readonly updated: string;
  readonly excerpt: string;
  readonly highlights: readonly HighlightRange[];
}

export interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface ChatRequest {
  readonly question: string;
  // Client-supplied and untrusted; the server re-bounds it to MAX_HISTORY_TURNS.
  readonly history: readonly ChatTurn[];
}

export interface ChatStreamError {
  readonly code: ChatErrorCode;
  readonly retryAfterSeconds?: number;
}

export type ChatStreamEvent =
  | { readonly type: 'accepted'; readonly quota: QuotaState }
  | { readonly type: 'sources'; readonly sources: readonly SourceCitation[] }
  | { readonly type: 'delta'; readonly text: string }
  | {
      readonly type: 'done';
      readonly coverage: 'answered' | 'none';
      readonly cited: readonly number[];
    }
  | { readonly type: 'error'; readonly error: ChatStreamError };

// Wire constants shared by the API and the browser (ADR-049).
export const CHAT_API_PATH = '/api/chat';
// Hard cap on the request body in bytes. The server also enforces limits.requestMaxBytes from SSM.
export const MAX_REQUEST_BYTES = 8192;
