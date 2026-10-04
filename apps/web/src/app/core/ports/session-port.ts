export type AuthProvider = 'a' | 'b';

export interface SessionInfo {
  readonly status: 'guest' | 'signed-in' | 'expired';
  readonly displayName?: string;
  // Known only when the identity provider or the API reports it; otherwise the next
  // 'accepted' event carries the real number.
  readonly quota?: { readonly left: number; readonly limit: number };
}

export interface SessionPort {
  read(): SessionInfo;
  // Resolves when the visitor is back from the provider with a session.
  beginSignIn(provider: AuthProvider): Promise<SessionInfo>;
  signOut(): void;
}
