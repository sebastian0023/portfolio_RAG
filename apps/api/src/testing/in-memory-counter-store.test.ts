import { runCounterStoreContract } from './counter-store-contract.js';
import { InMemoryCounterStore } from './in-memory-counter-store.js';

runCounterStoreContract('in-memory', {
  build() {
    const store = new InMemoryCounterStore();
    return {
      store,
      read: (key) => store.counts.get(key) ?? 0,
      breakStore: () => {
        store.failWith = new Error('store down');
      },
    };
  },
});
