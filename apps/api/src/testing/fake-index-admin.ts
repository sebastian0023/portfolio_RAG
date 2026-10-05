import type {
  IndexQuery,
  IndexQueryResult,
  IndexRepository,
} from '@portfolio/shared';
import type {
  IndexAdmin,
  IndexInfo,
  VectorRecord,
} from '../core/knowledge/ingest.js';
import { InMemoryIndexRepository } from './in-memory-index-repository.js';
import type { SeedRecord } from './in-memory-index-repository.js';

interface Stored {
  sha: string;
  complete: boolean;
  records: Map<string, SeedRecord>;
}

// An IndexAdmin and an IndexRepository over one in-memory store, with failure hooks for the ingest tests.
export class FakeIndexAdmin implements IndexAdmin, IndexRepository {
  readonly indexes = new Map<string, Stored>();
  readonly calls = {
    create: 0,
    put: 0,
    listKeys: 0,
    markComplete: 0,
    query: 0,
  };
  // Fails the nth put (1-based) once, to simulate a crash between batches.
  failPutNumber: number | undefined;
  // How many queries answer "nothing yet" before the data becomes searchable.
  queriesBeforeVisible = 0;

  describe(index: string): Promise<IndexInfo | undefined> {
    const stored = this.indexes.get(index);
    return Promise.resolve(
      stored === undefined
        ? undefined
        : { complete: stored.complete, manifestSha256: stored.sha },
    );
  }

  create(index: string, sha: string): Promise<void> {
    this.calls.create++;
    this.indexes.set(index, { sha, complete: false, records: new Map() });
    return Promise.resolve();
  }

  put(index: string, vectors: readonly VectorRecord[]): Promise<void> {
    this.calls.put++;
    if (this.failPutNumber === this.calls.put) {
      this.failPutNumber = undefined;
      return Promise.reject(new Error('RAW-ADMIN-DETAIL'));
    }
    const stored = this.indexes.get(index);
    if (stored === undefined) return Promise.reject(new Error('missing'));
    for (const v of vectors) {
      const m = v.metadata;
      stored.records.set(v.key, {
        chunkId: v.key,
        sourceId: String(m['sourceId']),
        kind: m['kind'] as SeedRecord['kind'],
        lang: 'en',
        updated: String(m['updated']),
        title: String(m['title']),
        section: String(m['section']),
        path: String(m['path']),
        text: String(m['text']),
        vector: v.vector,
      });
    }
    return Promise.resolve();
  }

  listKeys(index: string): Promise<readonly string[]> {
    this.calls.listKeys++;
    return Promise.resolve([
      ...(this.indexes.get(index)?.records.keys() ?? []),
    ]);
  }

  markComplete(index: string): Promise<void> {
    this.calls.markComplete++;
    const stored = this.indexes.get(index);
    if (stored) stored.complete = true;
    return Promise.resolve();
  }

  query(request: IndexQuery, signal?: AbortSignal): Promise<IndexQueryResult> {
    this.calls.query++;
    if (this.queriesBeforeVisible > 0) {
      this.queriesBeforeVisible--;
      return Promise.resolve({ ok: true, matches: [], dropped: 0 });
    }
    const stored = this.indexes.get(request.index);
    const repo = new InMemoryIndexRepository();
    if (stored) repo.addIndex(request.index, [...stored.records.values()]);
    return repo.query(request, signal);
  }
}
