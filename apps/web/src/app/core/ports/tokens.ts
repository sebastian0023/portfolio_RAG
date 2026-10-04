import { InjectionToken } from '@angular/core';
import type { ChatTransport } from './chat-transport';
import type { GuestCheckPort } from './guest-check-port';

export const CHAT_TRANSPORT = new InjectionToken<ChatTransport>(
  'CHAT_TRANSPORT',
);
export const GUEST_CHECK_PORT = new InjectionToken<GuestCheckPort>(
  'GUEST_CHECK_PORT',
);
