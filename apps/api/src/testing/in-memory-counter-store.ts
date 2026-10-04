import type {
  CounterItem,
  CounterStore,
  ReserveAllResult,
  ReserveOneResult,
} from '../core/admission/counter-store.js';

// Reference behaviour of CounterStore: conditional increments that never pass the limit.
export class InMemoryCounterStore implements CounterStore {
  readonly counts = new Map<string, number>();
  failWith: Error | undefined;

  reserve(item: CounterItem): Promise<ReserveOneResult> {
    if (this.failWith) return Promise.reject(this.failWith);
    const current = this.counts.get(item.key) ?? 0;
    if (current >= item.limit) return Promise.resolve({ ok: false });
    this.counts.set(item.key, current + 1);
    return Promise.resolve({ ok: true, count: current + 1 });
  }

  reserveAll(items: readonly CounterItem[]): Promise<ReserveAllResult> {
    if (this.failWith) return Promise.reject(this.failWith);
    const exceededIndex = items.findIndex(
      (item) => (this.counts.get(item.key) ?? 0) >= item.limit,
    );
    if (exceededIndex >= 0)
      return Promise.resolve({ ok: false, exceededIndex });
    for (const item of items) {
      this.counts.set(item.key, (this.counts.get(item.key) ?? 0) + 1);
    }
    return Promise.resolve({ ok: true });
  }
}
