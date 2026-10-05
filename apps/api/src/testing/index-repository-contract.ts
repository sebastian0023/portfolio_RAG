// Contract suite every IndexRepository adapter must pass (ADR-045). A harness builds a repository over seeded
// records (or a failing backend), so identical assertions run against the in-memory fake and the S3 Vectors
// adapter. Passing it does not prove service limits; that needs the live run (ADR-038).
import type {
  IndexErrorCode,
  IndexQuery,
  IndexRepository,
  SourceKind,
} from '@portfolio/shared';
import { EMBEDDING_CONFIG } from '@portfolio/shared';
import { describe, expect, test } from 'vitest';
import type { SeedRecord } from './in-memory-index-repository.js';

export const INDEX = 'chunks-0123456789abcdef';
export const RAW_DETAIL = 'RAW-BACKEND-DETAIL-9f2a';

export type Failure = Exclude<IndexErrorCode, 'not_found' | 'cancelled'>;

export interface BuiltIndex {
  readonly repository: IndexRepository;
  // How many times the backend was actually called.
  calls(): number;
}

export interface IndexHarness {
  build(options: {
    readonly records: readonly SeedRecord[];
    readonly failure?: Failure;
  }): BuiltIndex;
}

const DIMS = EMBEDDING_CONFIG.dimensions;

export function unit(slot: number): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[slot] = 1;
  return v;
}

export function record(
  chunkId: string,
  vector: readonly number[],
  extra: Partial<SeedRecord> = {},
): SeedRecord {
  const sourceId = chunkId.split('#')[0] ?? chunkId;
  return {
    chunkId,
    sourceId,
    vector,
    kind: 'faq' as SourceKind,
    lang: 'en',
    updated: '2026-01-01',
    title: `Title of ${sourceId}`,
    section: 'Section',
    path: `knowledge/${sourceId}.md`,
    text: `Text of ${chunkId}.`,
    ...extra,
  } as SeedRecord;
}

const query = (
  vector: readonly number[],
  extra: Partial<IndexQuery> = {},
): IndexQuery => ({
  index: INDEX,
  vector,
  topK: 5,
  ...extra,
});

export function runIndexRepositoryContract(
  name: string,
  harness: IndexHarness,
): void {
  describe(`IndexRepository contract: ${name}`, () => {
    test('orders by score descending and breaks ties by chunk id', async () => {
      const near = [...unit(0)];
      near[1] = 0.5;
      const built = harness.build({
        records: [
          record('bbb-doc#s-1', unit(0)),
          record('aaa-doc#s-1', unit(0)),
          record('ccc-doc#s-1', near),
          record('ddd-doc#s-1', unit(7)),
        ],
      });
      const result = await built.repository.query(query(unit(0)));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.matches.map((m) => m.chunkId)).toEqual([
        'aaa-doc#s-1',
        'bbb-doc#s-1',
        'ccc-doc#s-1',
        'ddd-doc#s-1',
      ]);
    });

    test('an identical vector scores 1 and an orthogonal one scores 0', async () => {
      const built = harness.build({
        records: [
          record('same-doc#s-1', unit(3)),
          record('other-doc#s-1', unit(9)),
        ],
      });
      const result = await built.repository.query(query(unit(3)));
      if (!result.ok) throw new Error('expected ok');
      const same = result.matches.find((m) => m.chunkId === 'same-doc#s-1');
      const other = result.matches.find((m) => m.chunkId === 'other-doc#s-1');
      expect(same?.score).toBeCloseTo(1, 5);
      expect(other?.score).toBeCloseTo(0, 5);
    });

    test('returns at most topK matches', async () => {
      const built = harness.build({
        records: Array.from({ length: 8 }, (_, i) =>
          record(`doc-${i}-aa#s-1`, unit(i)),
        ),
      });
      const result = await built.repository.query(query(unit(0), { topK: 3 }));
      expect(result.ok && result.matches).toHaveLength(3);
    });

    test('filters by language and by kind', async () => {
      const built = harness.build({
        records: [
          record('faq-doc#s-1', unit(0), { kind: 'faq' }),
          record('proj-doc#s-1', unit(0), { kind: 'project' }),
          record('skill-doc#s-1', unit(0), { kind: 'skill' }),
        ],
      });
      const kinds = await built.repository.query(
        query(unit(0), { filter: { kinds: ['project', 'skill'] } }),
      );
      expect(kinds.ok && kinds.matches.map((m) => m.kind).sort()).toEqual([
        'project',
        'skill',
      ]);
      const lang = await built.repository.query(
        query(unit(0), { filter: { lang: 'en', kinds: ['faq'] } }),
      );
      expect(lang.ok && lang.matches.map((m) => m.chunkId)).toEqual([
        'faq-doc#s-1',
      ]);
    });

    test('an index with no matching records returns an empty list, not an error', async () => {
      const built = harness.build({
        records: [record('faq-doc#s-1', unit(0), { kind: 'faq' })],
      });
      const result = await built.repository.query(
        query(unit(0), { filter: { kinds: ['education'] } }),
      );
      expect(result).toEqual({ ok: true, matches: [], dropped: 0 });
    });

    test('round-trips the citation metadata and an optional source URL', async () => {
      const built = harness.build({
        records: [
          record('link-doc#s-1', unit(0), {
            sourceUrl: 'https://example.org/a',
          }),
          record('plain-doc#s-1', unit(1)),
        ],
      });
      const result = await built.repository.query(query(unit(0)));
      if (!result.ok) throw new Error('expected ok');
      const linked = result.matches.find((m) => m.chunkId === 'link-doc#s-1');
      expect(linked).toMatchObject({
        sourceId: 'link-doc',
        sourceUrl: 'https://example.org/a',
        title: 'Title of link-doc',
        section: 'Section',
        path: 'knowledge/link-doc.md',
        updated: '2026-01-01',
        kind: 'faq',
        text: 'Text of link-doc#s-1.',
      });
      const plain = result.matches.find((m) => m.chunkId === 'plain-doc#s-1');
      expect(plain).toBeDefined();
      expect(plain && 'sourceUrl' in plain).toBe(false);
    });

    test('an unknown index is not_found', async () => {
      const built = harness.build({
        records: [record('faq-doc#s-1', unit(0))],
      });
      const result = await built.repository.query({
        ...query(unit(0)),
        index: 'chunks-ffffffffffffffff',
      });
      expect(result).toEqual({ ok: false, code: 'not_found' });
    });

    test.each([
      ['a short vector', [1, 2, 3], 5],
      ['a zero vector', new Array<number>(DIMS).fill(0), 5],
      ['a NaN value', [Number.NaN, ...new Array<number>(DIMS - 1).fill(1)], 5],
      ['topK of 0', unit(0), 0],
      ['topK above 20', unit(0), 21],
      ['a fractional topK', unit(0), 2.5],
    ])(
      'rejects %s without calling the backend',
      async (_name, vector, topK) => {
        const built = harness.build({
          records: [record('faq-doc#s-1', unit(0))],
        });
        const result = await built.repository.query(query(vector, { topK }));
        expect(result).toEqual({ ok: false, code: 'invalid_request' });
        expect(built.calls()).toBe(0);
      },
    );

    test('an aborted signal makes no backend call', async () => {
      const built = harness.build({
        records: [record('faq-doc#s-1', unit(0))],
      });
      const result = await built.repository.query(
        query(unit(0)),
        AbortSignal.abort(),
      );
      expect(result).toEqual({ ok: false, code: 'cancelled' });
      expect(built.calls()).toBe(0);
    });

    test.each(['throttled', 'unavailable', 'internal'] as const)(
      'maps a %s backend failure and never leaks its detail',
      async (failure) => {
        const built = harness.build({ records: [], failure });
        const result = await built.repository.query(query(unit(0)));
        expect(result).toEqual({ ok: false, code: failure });
        expect(JSON.stringify(result)).not.toContain(RAW_DETAIL);
      },
    );
  });
}
