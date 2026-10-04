import { describe, expect, it } from 'vitest';
import { HttpChatTransport } from '../adapters/http/http-chat-transport';
import { GuestOnlySession } from '../adapters/phase3/guest-session';
import { NotRequiredGuestCheck } from '../adapters/phase3/not-required-guest-check';
import {
  CHAT_TRANSPORT,
  GUEST_CHECK_PORT,
  SESSION_PORT,
} from '../core/ports/tokens';
import { createProviders } from './production-providers';

interface ValueProvider {
  provide: unknown;
  useValue: object;
}

describe('production wiring (ADR-043)', () => {
  const providers = createProviders(
    '?scenario=outGuest&mock=hang',
  ) as ValueProvider[];
  const valueFor = (token: unknown) =>
    providers.find((p) => p.provide === token)?.useValue;

  it('uses the HTTP transport and the honest Phase 3 session and guest check', () => {
    expect(valueFor(CHAT_TRANSPORT)).toBeInstanceOf(HttpChatTransport);
    expect(valueFor(SESSION_PORT)).toBeInstanceOf(GuestOnlySession);
    expect(valueFor(GUEST_CHECK_PORT)).toBeInstanceOf(NotRequiredGuestCheck);
  });

  it('wires nothing else, so no mock or harness provider can slip in', () => {
    expect(providers).toHaveLength(3);
    for (const provider of providers) {
      expect(provider.useValue.constructor.name).not.toMatch(/^Mock/);
    }
  });

  it('ignores the dev query parameters', () => {
    expect(createProviders('')).toHaveLength(
      createProviders('?scenario=x').length,
    );
  });

  it('is a guest-only session with sign-in hidden and a guest check that is not required', async () => {
    const session = valueFor(SESSION_PORT) as GuestOnlySession;
    expect(session.read()).toEqual({ status: 'guest' });
    expect(session.signInAvailable).toBe(false);
    await expect(session.beginSignIn()).rejects.toThrow();
    const check = valueFor(GUEST_CHECK_PORT) as NotRequiredGuestCheck;
    expect(check.required).toBe(false);
  });
});
