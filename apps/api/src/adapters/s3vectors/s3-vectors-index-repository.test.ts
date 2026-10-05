import type {
  QueryVectorsCommand,
  QueryVectorsCommandOutput,
} from '@aws-sdk/client-s3vectors';
import { describe, expect, test } from 'vitest';
import {
  INDEX,
  RAW_DETAIL,
  record,
  runIndexRepositoryContract,
  unit,
} from '../../testing/index-repository-contract.js';
import type { SeedRecord } from '../../testing/in-memory-index-repository.js';
import { matchesFilter } from '../../testing/in-memory-index-repository.js';
import { cosine } from '../../testing/vector-math.js';
import {
  S3VectorsIndexRepository,
  toServiceFilter,
  type S3VectorsClientLike,
} from './s3-vectors-index-repository.js';

const HOSTS = ['example.org'];
const BUCKET = 'portfolio-v2-prod-vectors';
const HASH = 'a'.repeat(64);

function metadataOf(r: SeedRecord): Record<string, unknown> {
  return {
    sourceId: r.sourceId,
    kind: r.kind,
    lang: r.lang,
    updated: r.updated,
    schema: 1,
    text: r.text,
    title: r.title,
    section: r.section,
    path: r.path,
    ...(r.sourceUrl === undefined ? {} : { url: r.sourceUrl }),
    contentHash: HASH,
  };
}

// Interprets the filter syntax this adapter emits ($eq, $in, $and) and cosine distance as 1 - similarity, and
// returns results worst-first so the adapter has to do its own ordering. It checks the adapter's use of the API,
// not the service; the live run (s3-vectors.live.test.ts) checks the service.
class FakeS3Vectors {
  readonly commands: QueryVectorsCommand[] = [];
  readonly #indexes = new Map<string, readonly SeedRecord[]>();
  failure: string | undefined;
  override: Partial<QueryVectorsCommandOutput> | undefined;
  metadataOverride: ((r: SeedRecord) => unknown) | undefined;

  add(name: string, records: readonly SeedRecord[]): this {
    this.#indexes.set(name, records);
    return this;
  }

  send = ((
    command: QueryVectorsCommand,
    options?: { abortSignal?: AbortSignal },
  ) => {
    this.commands.push(command);
    if (options?.abortSignal?.aborted) {
      return Promise.reject(
        Object.assign(new Error('aborted'), { name: 'AbortError' }),
      );
    }
    if (this.failure !== undefined) {
      return Promise.reject(
        Object.assign(new Error(RAW_DETAIL), { name: this.failure }),
      );
    }
    const input = command.input;
    const records = this.#indexes.get(input.indexName ?? '');
    if (records === undefined) {
      return Promise.reject(
        Object.assign(new Error(RAW_DETAIL), { name: 'NotFoundException' }),
      );
    }
    const filter = input.filter as Record<string, unknown> | undefined;
    const vectors = records
      .filter((r) => passes(r, filter))
      .map((r) => ({
        key: r.chunkId,
        distance: 1 - cosine(input.queryVector?.float32 ?? [], r.vector),
        metadata: this.metadataOverride
          ? this.metadataOverride(r)
          : metadataOf(r),
      }))
      .sort((a, b) => b.distance - a.distance || (a.key < b.key ? 1 : -1))
      .slice(-(input.topK ?? 0));
    return Promise.resolve({
      $metadata: {},
      distanceMetric: 'cosine',
      vectors: vectors.reverse().reverse(),
      ...this.override,
    } as QueryVectorsCommandOutput);
  }) satisfies S3VectorsClientLike['send'];
}

function passes(
  r: SeedRecord,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (filter === undefined) return true;
  const clauses = (filter['$and'] as Record<string, unknown>[] | undefined) ?? [
    filter,
  ];
  const lang = clauses
    .map((c) => c['lang'] as { $eq: string } | undefined)
    .find(Boolean);
  const kind = clauses
    .map((c) => c['kind'] as { $in: string[] } | undefined)
    .find(Boolean);
  return matchesFilter(r, {
    ...(lang === undefined ? {} : { lang: lang.$eq as 'en' }),
    ...(kind === undefined ? {} : { kinds: kind.$in as never }),
  });
}

const make = (fake: FakeS3Vectors) =>
  new S3VectorsIndexRepository(fake, { bucket: BUCKET, allowedHosts: HOSTS });

runIndexRepositoryContract('S3 Vectors adapter with a fake client', {
  build({ records, failure }) {
    const fake = new FakeS3Vectors().add(INDEX, records);
    if (failure !== undefined) {
      fake.failure =
        failure === 'throttled'
          ? 'TooManyRequestsException'
          : failure === 'unavailable'
            ? 'ServiceUnavailableException'
            : 'SomethingUnexpected';
    }
    return { repository: make(fake), calls: () => fake.commands.length };
  },
});

describe('S3 Vectors adapter specifics', () => {
  const run = async (fake: FakeS3Vectors, extra = {}) =>
    make(fake).query({ index: INDEX, vector: unit(0), topK: 5, ...extra });

  test('asks for metadata and distance on the right bucket and index', async () => {
    const fake = new FakeS3Vectors().add(INDEX, [
      record('faq-doc#s-1', unit(0)),
    ]);
    await run(fake);
    expect(fake.commands[0]?.input).toMatchObject({
      vectorBucketName: BUCKET,
      indexName: INDEX,
      topK: 5,
      returnMetadata: true,
      returnDistance: true,
    });
    expect(fake.commands[0]?.input.queryVector?.float32).toHaveLength(512);
    expect(fake.commands[0]?.input.filter).toBeUndefined();
  });

  test('builds the service filter from the typed filter', () => {
    expect(toServiceFilter(undefined)).toBeUndefined();
    expect(toServiceFilter({ lang: 'en' })).toEqual({ lang: { $eq: 'en' } });
    expect(toServiceFilter({ kinds: ['faq', 'skill'] })).toEqual({
      kind: { $in: ['faq', 'skill'] },
    });
    expect(toServiceFilter({ lang: 'en', kinds: ['faq'] })).toEqual({
      $and: [{ lang: { $eq: 'en' } }, { kind: { $in: ['faq'] } }],
    });
  });

  test('refuses an index name that is not chunks-<16 hex> without a call', async () => {
    const fake = new FakeS3Vectors();
    for (const index of [
      'none',
      '../x',
      'chunks-short',
      `chunks-${'a'.repeat(64)}`,
    ]) {
      expect(
        await make(fake).query({ index, vector: unit(0), topK: 1 }),
      ).toEqual({
        ok: false,
        code: 'invalid_request',
      });
    }
    expect(fake.commands).toHaveLength(0);
  });

  test('drops a match whose metadata is invalid and counts it', async () => {
    const fake = new FakeS3Vectors().add(INDEX, [
      record('good-doc#s-1', unit(0)),
      record('long-doc#s-1', unit(0), { text: 'x'.repeat(601) }),
      record('host-doc#s-1', unit(0), {
        sourceUrl: 'https://evil.example.net/a',
      }),
      record('http-doc#s-1', unit(0), { sourceUrl: 'http://example.org/a' }),
    ]);
    const result = await run(fake);
    expect(result).toMatchObject({ ok: true, dropped: 3 });
    expect(result.ok && result.matches.map((m) => m.chunkId)).toEqual([
      'good-doc#s-1',
    ]);
  });

  test('drops a match with an unexpected metadata key or a missing one', async () => {
    const fake = new FakeS3Vectors().add(INDEX, [
      record('extra-doc#s-1', unit(0)),
      record('miss-doc#s-1', unit(0)),
    ]);
    fake.metadataOverride = (r) => {
      const m = metadataOf(r);
      if (r.chunkId.startsWith('extra')) return { ...m, injected: 'x' };
      return Object.fromEntries(
        Object.entries(m).filter(([k]) => k !== 'title'),
      );
    };
    expect(await run(fake)).toEqual({ ok: true, matches: [], dropped: 2 });
  });

  test('a key that is not a chunk id is a malformed response, not a match', async () => {
    const fake = new FakeS3Vectors().add(INDEX, [
      record('good-doc#s-1', unit(0)),
    ]);
    fake.override = {
      vectors: [{ key: 'not a chunk id', distance: 0, metadata: {} }],
    };
    expect(await run(fake)).toEqual({ ok: false, code: 'internal' });
  });

  test('a distance metric other than cosine is refused', async () => {
    const fake = new FakeS3Vectors().add(INDEX, [
      record('good-doc#s-1', unit(0)),
    ]);
    fake.override = { distanceMetric: 'euclidean' };
    expect(await run(fake)).toEqual({ ok: false, code: 'internal' });
  });

  test('an access denial reads as unavailable, like the kill switch', async () => {
    const fake = new FakeS3Vectors().add(INDEX, []);
    fake.failure = 'AccessDeniedException';
    expect(await run(fake)).toEqual({ ok: false, code: 'unavailable' });
  });
});
