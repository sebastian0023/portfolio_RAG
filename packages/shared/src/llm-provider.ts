// One earlier message. Providers receive native multi-turn history; the caller has already normalised it to
// alternate roles, start with a user turn, and end with an assistant turn.
export interface LLMTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface LLMRequest {
  readonly systemPrompt: string;
  readonly history: readonly LLMTurn[];
  readonly userMessage: string;
  readonly maxOutputTokens: number;
}

export interface LLMUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type LLMErrorCode =
  | 'cancelled'
  | 'throttled'
  | 'unavailable'
  | 'invalid_request'
  | 'content_filtered'
  | 'internal';

// Provider-neutral failure; adapters map SDK errors here and never forward raw provider messages.
export interface LLMError {
  readonly code: LLMErrorCode;
  readonly retryable: boolean;
}

export type LLMStopReason = 'end' | 'max_tokens';

export type LLMEvent =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'usage'; readonly usage: LLMUsage }
  | { readonly type: 'error'; readonly error: LLMError }
  | { readonly type: 'done'; readonly stopReason: LLMStopReason };

export interface LLMProvider {
  readonly id: string;
  // Aborting the signal ends the stream with a 'cancelled' error event.
  stream(request: LLMRequest, signal?: AbortSignal): AsyncIterable<LLMEvent>;
}
