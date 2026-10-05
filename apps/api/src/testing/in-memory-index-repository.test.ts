import { describe, expect, test } from 'vitest';
import { FakeEmbedder } from './fake-embedder.js';
import { cosine } from './vector-math.js';
import { runEmbedderContract } from './embedder-contract.js';
import {
  INDEX,
  runIndexRepositoryContract,
  type Failure,
} from './index-repository-contract.js';
import {
  InMemoryIndexRepository,
  type SeedRecord,
} from './in-memory-index-repository.js';
import type { IndexQueryResult, IndexRepository } from '@portfolio/shared';

// A backend that always fails, to exercise the failure rows of the contract on the fake.
function failing(code: Failure): IndexRepository {
  return {
    query: (): Promise<IndexQueryResult> =>
      Promise.resolve({ ok: false, code }),
  };
}

runIndexRepositoryContract('in-memory fake', {
  build({ records, failure }) {
    if (failure !== undefined)
      return { repository: failing(failure), calls: () => 0 };
    const repository = new InMemoryIndexRepository().addIndex(
      INDEX,
      records as readonly SeedRecord[],
    );
    return { repository, calls: () => repository.calls() };
  },
});

runEmbedderContract('fake embedder', {
  build(scenario) {
    const embedder = new FakeEmbedder();
    if (scenario.kind === 'error') {
      return {
        embedder: {
          config: embedder.config,
          embed: () => Promise.resolve({ ok: false, code: scenario.code }),
        },
        calls: () => 0,
      };
    }
    return { embedder, calls: () => embedder.calls() };
  },
});

describe('fake embedder', () => {
  test('texts that share words are closer than unrelated texts', async () => {
    const e = new FakeEmbedder();
    const get = async (t: string) => {
      const r = await e.embed(t);
      if (!r.ok) throw new Error('embed failed');
      return r.vector;
    };
    const q = await get('database and distributed systems courses');
    const near = await get(
      'distributed systems and databases were favorite courses',
    );
    const far = await get('hiking trails elevation printable page');
    expect(cosine(q, near)).toBeGreaterThan(cosine(q, far));
  });
});
