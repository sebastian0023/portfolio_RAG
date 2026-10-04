import { InjectionToken } from '@angular/core';
import type { ChatTransport } from './chat-transport';
import type { GuestCheckPort } from './guest-check-port';
import type { SessionPort } from './session-port';

export const CHAT_TRANSPORT = new InjectionToken<ChatTransport>(
  'CHAT_TRANSPORT',
);
export const SESSION_PORT = new InjectionToken<SessionPort>('SESSION_PORT');
export const GUEST_CHECK_PORT = new InjectionToken<GuestCheckPort>(
  'GUEST_CHECK_PORT',
);
