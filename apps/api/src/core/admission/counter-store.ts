// Atomic counters with a ceiling (ADR-017). Every reservation is a conditional increment: it either raises
// the count by one while it is below the limit, or changes nothing. Failures throw, and callers fail closed.
export interface CounterItem {
  readonly key: string;
  readonly limit: number;
  // Epoch seconds. TTL cleanup only; the window is part of the key.
  readonly expiresAt: number;
}

export type ReserveOneResult =
  { readonly ok: true; readonly count: number } | { readonly ok: false };

export type ReserveAllResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly exceededIndex: number };

export interface CounterStore {
  reserve(item: CounterItem): Promise<ReserveOneResult>;
  // All items are incremented together or none is, so a refused principal never burns shared capacity.
  reserveAll(items: readonly CounterItem[]): Promise<ReserveAllResult>;
  // Strongly consistent current count; a key that was never written is 0. Used to report what is left.
  read(key: string): Promise<number>;
}
