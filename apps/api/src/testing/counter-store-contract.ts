// Contract every CounterStore must pass. The same assertions run against the in-memory reference and the
// DynamoDB adapter (driven by a fake that applies the adapter's own condition expression).
import { describe, expect, test } from 'vitest';
import type { CounterStore } from '../core/admission/counter-store.js';

export interface CounterHarness {
  build(): {
    store: CounterStore;
    read(key: string): number;
    breakStore(): void;
  };
}

const item = (key: string, limit: number) => ({
  key,
  limit,
  expiresAt: 1_900_000_000,
});

export function runCounterStoreContract(
  name: string,
  harness: CounterHarness,
): void {
  describe(`CounterStore contract: ${name}`, () => {
    test('counts up to the limit and refuses the next reservation', async () => {
      const { store, read } = harness.build();
      for (const expected of [1, 2, 3]) {
        expect(await store.reserve(item('k', 3))).toEqual({
          ok: true,
          count: expected,
        });
      }
      expect(await store.reserve(item('k', 3))).toEqual({ ok: false });
      expect(read('k')).toBe(3);
    });

    test('concurrent reservations at the limit admit exactly the remaining count', async () => {
      const { store, read } = harness.build();
      await store.reserve(item('k', 10));
      const results = await Promise.all(
        Array.from({ length: 25 }, () => store.reserve(item('k', 10))),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(9);
      expect(read('k')).toBe(10);
    });

    test('reserveAll increments every item together', async () => {
      const { store, read } = harness.build();
      expect(await store.reserveAll([item('a', 5), item('b', 5)])).toEqual({
        ok: true,
      });
      expect([read('a'), read('b')]).toEqual([1, 1]);
    });

    test('reserveAll changes nothing and names the exceeded item when one is at its limit', async () => {
      const { store, read } = harness.build();
      await store.reserve(item('b', 1));
      const result = await store.reserveAll([item('a', 5), item('b', 1)]);
      expect(result).toEqual({ ok: false, exceededIndex: 1 });
      expect(read('a')).toBe(0);
      expect(read('b')).toBe(1);
    });

    test('concurrent reserveAll never overshoots either counter', async () => {
      const { store, read } = harness.build();
      const results = await Promise.all(
        Array.from({ length: 30 }, () =>
          store.reserveAll([item('ip', 10), item('global', 40)]),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(10);
      expect(read('ip')).toBe(10);
      expect(read('global')).toBe(10);
    });

    test('a refused request does not consume shared capacity', async () => {
      const { store, read } = harness.build();
      for (let i = 0; i < 5; i += 1)
        await store.reserveAll([item('ip', 1), item('global', 40)]);
      expect(read('global')).toBe(1);
    });

    test('read returns 0 for a key never written and the count after reservations', async () => {
      const { store } = harness.build();
      expect(await store.read('never')).toBe(0);
      await store.reserve(item('k', 5));
      await store.reserve(item('k', 5));
      expect(await store.read('k')).toBe(2);
      await store.reserveAll([item('k', 5), item('other', 5)]);
      expect(await store.read('k')).toBe(3);
      expect(await store.read('other')).toBe(1);
    });

    test('an unavailable store throws instead of admitting', async () => {
      const { store, breakStore } = harness.build();
      breakStore();
      await expect(store.reserve(item('k', 3))).rejects.toThrow();
      await expect(store.reserveAll([item('k', 3)])).rejects.toThrow();
      await expect(store.read('k')).rejects.toThrow();
    });
  });
}
