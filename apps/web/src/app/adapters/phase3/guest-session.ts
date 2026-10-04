import type { SessionInfo, SessionPort } from '../../core/ports/session-port';

// Phase 3 has no identity provider (Cognito arrives in Phase 4), so every visitor is a guest and the sign-in
// control is hidden. Replaced by the Cognito adapter in P4-02.
export class GuestOnlySession implements SessionPort {
  readonly signInAvailable = false;

  read(): SessionInfo {
    return { status: 'guest' };
  }

  beginSignIn(): Promise<SessionInfo> {
    return Promise.reject(new Error('Sign-in is not available yet.'));
  }

  signOut(): void {
    // Nothing to end: there is never a session.
  }
}
