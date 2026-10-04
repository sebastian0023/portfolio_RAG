import type { EnvironmentProviders, Provider } from '@angular/core';
import { HttpChatTransport } from '../adapters/http/http-chat-transport';
import { GuestOnlySession } from '../adapters/phase3/guest-session';
import { NotRequiredGuestCheck } from '../adapters/phase3/not-required-guest-check';
import {
  CHAT_TRANSPORT,
  GUEST_CHECK_PORT,
  SESSION_PORT,
} from '../core/ports/tokens';

// Production wiring (ADR-043): the real HTTP transport and the honest Phase 3 session and guest check. There
// are no mocks and no scenario harness here. Phase 4 replaces the session and the guest check with Cognito
// and Turnstile adapters.
export function createProviders(
  search: string,
): (Provider | EnvironmentProviders)[] {
  // The query string only drives the development harness; production ignores it.
  void search;
  return [
    { provide: SESSION_PORT, useValue: new GuestOnlySession() },
    { provide: CHAT_TRANSPORT, useValue: new HttpChatTransport() },
    { provide: GUEST_CHECK_PORT, useValue: new NotRequiredGuestCheck() },
  ];
}
