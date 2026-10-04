import type { ChatStreamEvent } from '@portfolio/shared';
import type { ChatService } from './chat-handler.js';

// Fail-closed placeholder used until the plain chat service is wired (P3-04). It is never paid and never
// answers, so a deployment that reaches it is safe.
export const unavailableService: ChatService = {
  async *stream(): AsyncGenerator<ChatStreamEvent> {
    yield { type: 'error', error: { code: 'unavailable' } };
  },
};
