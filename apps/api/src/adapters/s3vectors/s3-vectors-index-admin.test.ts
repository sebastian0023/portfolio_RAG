import { describe, expect, test } from 'vitest';
import {
  CreateIndexCommand,
  GetIndexCommand,
  ListTagsForResourceCommand,
  ListVectorsCommand,
  PutVectorsCommand,
  TagResourceCommand,
} from '@aws-sdk/client-s3vectors';
import {
  S3VectorsIndexAdmin,
  type S3VectorsAdminClientLike,
} from './s3-vectors-index-admin.js';

const BUCKET = 'portfolio-v2-prod-vectors';
const INDEX = 'chunks-0123456789abcdef';
const ARN = `arn:aws:s3vectors:us-east-1:123456789012:bucket/${BUCKET}/index/${INDEX}`;

class Fake {
  readonly commands: unknown[] = [];
  exists = true;
  tags: Record<string, string> = {
    ManifestSha256: 'a'.repeat(64),
    IngestStatus: 'pending',
  };
  config = { dimension: 512, distanceMetric: 'cosine', dataType: 'float32' };
  pages: { vectors: { key: string }[]; nextToken?: string }[] = [];

  send = ((command: unknown): Promise<unknown> => {
    this.commands.push(command);
    if (command instanceof GetIndexCommand) {
      if (!this.exists) {
        return Promise.reject(
          Object.assign(new Error('RAW'), { name: 'NotFoundException' }),
        );
      }
      return Promise.resolve({ index: { indexArn: ARN, ...this.config } });
    }
    if (command instanceof ListTagsForResourceCommand)
      return Promise.resolve({ tags: this.tags });
    if (command instanceof TagResourceCommand) {
      Object.assign(this.tags, command.input.tags);
      return Promise.resolve({});
    }
    if (command instanceof ListVectorsCommand) {
      return Promise.resolve(this.pages.shift() ?? { vectors: [] });
    }
    return Promise.resolve({});
  }) satisfies S3VectorsAdminClientLike['send'];
}

const make = (fake: Fake) =>
  new S3VectorsIndexAdmin(fake, BUCKET, {
    Application: 'portfolio-v2',
    Environment: 'prod',
    CostScope: 'portfolio-v2-prod',
    ManagedBy: 'ingest',
  });

describe('S3VectorsIndexAdmin', () => {
  test('describe reports the completion tag and the manifest hash', async () => {
    const fake = new Fake();
    expect(await make(fake).describe(INDEX)).toEqual({
      complete: false,
      manifestSha256: 'a'.repeat(64),
    });
    fake.tags['IngestStatus'] = 'complete';
    expect(await make(fake).describe(INDEX)).toMatchObject({ complete: true });
  });

  test('describe of a missing index is undefined, not an error', async () => {
    const fake = new Fake();
    fake.exists = false;
    expect(await make(fake).describe(INDEX)).toBeUndefined();
  });

  test('describe refuses an index whose configuration is not ours', async () => {
    for (const config of [
      { dimension: 1024, distanceMetric: 'cosine', dataType: 'float32' },
      { dimension: 512, distanceMetric: 'euclidean', dataType: 'float32' },
    ]) {
      const fake = new Fake();
      fake.config = config;
      await expect(make(fake).describe(INDEX)).rejects.toThrow(
        'index lookup failed',
      );
    }
  });

  test('create sends the pinned configuration and a pending tag with the hash', async () => {
    const fake = new Fake();
    await make(fake).create(INDEX, 'b'.repeat(64));
    const command = fake.commands[0] as CreateIndexCommand;
    expect(command.input).toMatchObject({
      vectorBucketName: BUCKET,
      indexName: INDEX,
      dataType: 'float32',
      dimension: 512,
      distanceMetric: 'cosine',
      metadataConfiguration: {
        nonFilterableMetadataKeys: [
          'text',
          'title',
          'section',
          'path',
          'url',
          'contentHash',
        ],
      },
      tags: {
        Application: 'portfolio-v2',
        CostScope: 'portfolio-v2-prod',
        ManagedBy: 'ingest',
        ManifestSha256: 'b'.repeat(64),
        IngestStatus: 'pending',
      },
    });
  });

  test('put sends float32 vectors with metadata, split at the service batch limit', async () => {
    const fake = new Fake();
    const vectors = Array.from({ length: 501 }, (_, i) => ({
      key: `doc-${i}-aa#s-1`,
      vector: [0.5, 0.25],
      metadata: { kind: 'faq' },
    }));
    await make(fake).put(INDEX, vectors);
    const puts = fake.commands.filter(
      (c): c is PutVectorsCommand => c instanceof PutVectorsCommand,
    );
    expect(puts.map((c) => c.input.vectors?.length)).toEqual([500, 1]);
    expect(puts[0]?.input.vectors?.[0]).toEqual({
      key: 'doc-0-aa#s-1',
      data: { float32: [0.5, 0.25] },
      metadata: { kind: 'faq' },
    });
  });

  test('listKeys follows pagination', async () => {
    const fake = new Fake();
    fake.pages = [
      { vectors: [{ key: 'a' }, { key: 'b' }], nextToken: 't1' },
      { vectors: [{ key: 'c' }] },
    ];
    expect(await make(fake).listKeys(INDEX)).toEqual(['a', 'b', 'c']);
    const lists = fake.commands.filter(
      (c): c is ListVectorsCommand => c instanceof ListVectorsCommand,
    );
    expect(lists[1]?.input.nextToken).toBe('t1');
  });

  test('markComplete tags the index it just looked up', async () => {
    const fake = new Fake();
    await make(fake).markComplete(INDEX);
    const tag = fake.commands.find(
      (c): c is TagResourceCommand => c instanceof TagResourceCommand,
    );
    expect(tag?.input).toEqual({
      resourceArn: ARN,
      tags: { IngestStatus: 'complete' },
    });
  });

  test('every operation refuses a name that is not chunks-<16 hex> before any call', async () => {
    const fake = new Fake();
    const admin = make(fake);
    for (const bad of ['none', '../x', 'chunks-short']) {
      await expect(admin.describe(bad)).rejects.toThrow();
      await expect(admin.create(bad, 'x')).rejects.toThrow();
      await expect(admin.put(bad, [])).rejects.toThrow();
      await expect(admin.listKeys(bad)).rejects.toThrow();
      await expect(admin.markComplete(bad)).rejects.toThrow();
    }
    expect(fake.commands).toHaveLength(0);
  });

  test('a service failure never carries its raw message', async () => {
    const fake = new Fake();
    fake.send = (() =>
      Promise.reject(
        Object.assign(new Error('RAW-SECRET'), {
          name: 'ServiceUnavailableException',
        }),
      )) as never;
    await expect(make(fake).describe(INDEX)).rejects.toThrow(
      /^index lookup failed$/,
    );
  });
});
