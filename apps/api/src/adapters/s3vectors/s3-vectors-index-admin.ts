import {
  CreateIndexCommand,
  GetIndexCommand,
  ListTagsForResourceCommand,
  ListVectorsCommand,
  PutVectorsCommand,
  TagResourceCommand,
} from '@aws-sdk/client-s3vectors';
import { z } from 'zod';
import {
  INDEX_CONFIG,
  INDEX_NAME_PATTERN,
} from '../../core/knowledge/config.js';
import type {
  IndexAdmin,
  IndexInfo,
  VectorRecord,
} from '../../core/knowledge/ingest.js';

type AdminCommand =
  | CreateIndexCommand
  | GetIndexCommand
  | ListTagsForResourceCommand
  | ListVectorsCommand
  | PutVectorsCommand
  | TagResourceCommand;

// Replies are validated with zod below, so the client can be typed loosely.
export interface S3VectorsAdminClientLike {
  send(
    command: AdminCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

const indexSchema = z.object({
  index: z.object({
    indexArn: z.string().min(1),
    dimension: z.literal(INDEX_CONFIG.dimension),
    distanceMetric: z.literal(INDEX_CONFIG.distanceMetric),
    dataType: z.literal(INDEX_CONFIG.dataType),
  }),
});
const tagsSchema = z.object({ tags: z.record(z.string(), z.string()) });
const listSchema = z.object({
  vectors: z.array(z.object({ key: z.string() })),
  nextToken: z.string().optional(),
});

const LIST_PAGE = 500;
// The service accepts up to 500 vectors per PutVectors call.
const PUT_LIMIT = 500;

const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { name?: unknown }).name === 'NotFoundException';

// Index administration for the ingest tool (ADR-053). Every reply is validated, and an index whose configuration
// is not the one in INDEX_CONFIG is an error: a different dimension or metric would silently corrupt retrieval.
export class S3VectorsIndexAdmin implements IndexAdmin {
  readonly #client: S3VectorsAdminClientLike;
  readonly #bucket: string;
  readonly #tags: Readonly<Record<string, string>>;

  constructor(
    client: S3VectorsAdminClientLike,
    bucket: string,
    tags: Readonly<Record<string, string>>,
  ) {
    this.#client = client;
    this.#bucket = bucket;
    this.#tags = tags;
  }

  #assertName(index: string): void {
    if (!INDEX_NAME_PATTERN.test(index)) throw new Error('invalid index name');
  }

  async #arn(index: string, signal?: AbortSignal): Promise<string | undefined> {
    this.#assertName(index);
    try {
      const out = await this.#client.send(
        new GetIndexCommand({
          vectorBucketName: this.#bucket,
          indexName: index,
        }),
        signal === undefined ? undefined : { abortSignal: signal },
      );
      return indexSchema.parse(out).index.indexArn;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      // The cause stays attached for debugging in a debugger; the core discards it and the CLI never prints it.
      throw new Error('index lookup failed', { cause: error });
    }
  }

  async describe(
    index: string,
    signal?: AbortSignal,
  ): Promise<IndexInfo | undefined> {
    const arn = await this.#arn(index, signal);
    if (arn === undefined) return undefined;
    const out = await this.#client.send(
      new ListTagsForResourceCommand({ resourceArn: arn }),
      signal === undefined ? undefined : { abortSignal: signal },
    );
    const { tags } = tagsSchema.parse(out);
    return {
      complete: tags['IngestStatus'] === 'complete',
      manifestSha256: tags['ManifestSha256'],
    };
  }

  async create(
    index: string,
    manifestSha256: string,
    signal?: AbortSignal,
  ): Promise<void> {
    this.#assertName(index);
    await this.#client.send(
      new CreateIndexCommand({
        vectorBucketName: this.#bucket,
        indexName: index,
        dataType: INDEX_CONFIG.dataType,
        dimension: INDEX_CONFIG.dimension,
        distanceMetric: INDEX_CONFIG.distanceMetric,
        metadataConfiguration: {
          nonFilterableMetadataKeys: [
            ...INDEX_CONFIG.nonFilterableMetadataKeys,
          ],
        },
        tags: {
          ...this.#tags,
          ManifestSha256: manifestSha256,
          IngestStatus: 'pending',
        },
      }),
      signal === undefined ? undefined : { abortSignal: signal },
    );
  }

  async put(
    index: string,
    vectors: readonly VectorRecord[],
    signal?: AbortSignal,
  ): Promise<void> {
    this.#assertName(index);
    for (let i = 0; i < vectors.length; i += PUT_LIMIT) {
      await this.#client.send(
        new PutVectorsCommand({
          vectorBucketName: this.#bucket,
          indexName: index,
          vectors: vectors.slice(i, i + PUT_LIMIT).map((v) => ({
            key: v.key,
            data: { float32: [...v.vector] },
            metadata: { ...v.metadata },
          })),
        }),
        signal === undefined ? undefined : { abortSignal: signal },
      );
    }
  }

  async listKeys(
    index: string,
    signal?: AbortSignal,
  ): Promise<readonly string[]> {
    this.#assertName(index);
    const keys: string[] = [];
    let nextToken: string | undefined;
    do {
      const out = await this.#client.send(
        new ListVectorsCommand({
          vectorBucketName: this.#bucket,
          indexName: index,
          maxResults: LIST_PAGE,
          ...(nextToken === undefined ? {} : { nextToken }),
        }),
        signal === undefined ? undefined : { abortSignal: signal },
      );
      const page = listSchema.parse(out);
      keys.push(...page.vectors.map((v) => v.key));
      nextToken = page.nextToken;
    } while (nextToken !== undefined);
    return keys;
  }

  async markComplete(index: string, signal?: AbortSignal): Promise<void> {
    const arn = await this.#arn(index, signal);
    if (arn === undefined) throw new Error('index not found');
    await this.#client.send(
      new TagResourceCommand({
        resourceArn: arn,
        tags: { IngestStatus: 'complete' },
      }),
      signal === undefined ? undefined : { abortSignal: signal },
    );
  }
}
