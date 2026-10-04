import type { EnvironmentProviders, Provider } from '@angular/core';
import { environment } from '../../environments/environment';
import { HttpChatTransport } from '../adapters/http/http-chat-transport';
import { TurnstileGuestCheck } from '../adapters/turnstile/turnstile-guest-check';
import { CHAT_TRANSPORT, GUEST_CHECK_PORT } from '../core/ports/tokens';

// Production wiring (ADR-043): the real HTTP transport and the Turnstile guest check, which share one
// guest pass (ADR-052). There are no mocks and no scenario harness here.
export function createProviders(
  search: string,
): (Provider | EnvironmentProviders)[] {
  // The query string only drives the development harness; production ignores it.
  void search;
  const guestCheck = new TurnstileGuestCheck({
    siteKey: environment.turnstileSiteKey,
  });
  return [
    {
      provide: CHAT_TRANSPORT,
      useValue: new HttpChatTransport(undefined, () => guestCheck.getPass()),
    },
    { provide: GUEST_CHECK_PORT, useValue: guestCheck },
  ];
}
