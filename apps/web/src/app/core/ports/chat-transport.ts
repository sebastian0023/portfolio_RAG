import type { ChatRequest, ChatStreamEvent } from '@portfolio/shared';

// The request never reached the server (offline, DNS, refused). Server-decided failures are
// 'error' events instead (ADR-048), so the UI can tell "retry later" from "check your connection".
export class NetworkError extends Error {
  override readonly name = 'NetworkError';
}

export interface ChatTransport {
  // Aborting the signal ends the stream early; the facade ignores whatever follows.
  send(
    request: ChatRequest,
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamEvent>;
}
