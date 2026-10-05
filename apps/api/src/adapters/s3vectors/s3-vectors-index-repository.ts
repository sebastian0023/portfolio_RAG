import {
  QueryVectorsCommand,
  type QueryVectorsCommandOutput,
} from '@aws-sdk/client-s3vectors';
import type {
  IndexFilter,
  IndexMatch,
  IndexQuery,
  IndexQueryResult,
  IndexRepository,
} from '@portfolio/shared';
import { ALLOWED_SOURCE_HOSTS, EMBEDDING_CONFIG } from '@portfolio/shared';
import { INDEX_NAME_PATTERN } from '../../core/knowledge/config.js';
import { mapIndexError } from './error-map.js';
import { metadataSchema, queryOutputSchema } from './query-vectors-schema.js';

// The slice of the SDK client this adapter uses, so tests pass a fake.
export interface S3VectorsClientLike {
  send(
    command: QueryVectorsCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<QueryVectorsCommandOutput>;
}

export interface S3VectorsIndexRepositoryOptions {
  readonly bucket: string;
  readonly allowedHosts?: readonly string[];
}

const MAX_TOP_K = 20;

// The service filter syntax is built here from the typed filter, never taken from the caller (ADR-038).
export function toServiceFilter(
  filter: IndexFilter | undefined,
): Record<string, unknown> | undefined {
  const parts: Record<string, unknown>[] = [];
  if (filter?.lang !== undefined) parts.push({ lang: { $eq: filter.lang } });
  if (filter?.kinds !== undefined)
    parts.push({ kind: { $in: [...filter.kinds] } });
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : { $and: parts };
}

export class S3VectorsIndexRepository implements IndexRepository {
  readonly #client: S3VectorsClientLike;
  readonly #options: S3VectorsIndexRepositoryOptions;

  constructor(
    client: S3VectorsClientLike,
    options: S3VectorsIndexRepositoryOptions,
  ) {
    this.#client = client;
    this.#options = options;
  }

  async query(
    request: IndexQuery,
    signal?: AbortSignal,
  ): Promise<IndexQueryResult> {
    if (signal?.aborted) return { ok: false, code: 'cancelled' };
    if (
      !INDEX_NAME_PATTERN.test(request.index) ||
      request.vector.length !== EMBEDDING_CONFIG.dimensions ||
      !request.vector.every(Number.isFinite) ||
      !request.vector.some((x) => x !== 0) ||
      !Number.isInteger(request.topK) ||
      request.topK < 1 ||
      request.topK > MAX_TOP_K
    ) {
      return { ok: false, code: 'invalid_request' };
    }

    const filter = toServiceFilter(request.filter);
    let raw: QueryVectorsCommandOutput;
    try {
      raw = await this.#client.send(
        new QueryVectorsCommand({
          vectorBucketName: this.#options.bucket,
          indexName: request.index,
          topK: request.topK,
          queryVector: { float32: [...request.vector] },
          returnMetadata: true,
          returnDistance: true,
          ...(filter === undefined ? {} : { filter: filter as never }),
        }),
        signal === undefined ? undefined : { abortSignal: signal },
      );
    } catch (error) {
      return { ok: false, code: mapIndexError(error, signal) };
    }

    const output = queryOutputSchema.safeParse(raw);
    if (!output.success) return { ok: false, code: 'internal' };

    const schema = metadataSchema(
      this.#options.allowedHosts ?? ALLOWED_SOURCE_HOSTS,
    );
    const matches: IndexMatch[] = [];
    let dropped = 0;
    for (const vector of output.data.vectors) {
      const metadata = schema.safeParse(vector.metadata);
      if (!metadata.success) {
        dropped++;
        continue;
      }
      const { url, text, title, section, path, updated, kind, sourceId } =
        metadata.data;
      matches.push({
        chunkId: vector.key,
        sourceId,
        // Cosine distance is 1 - similarity (checked by the live run), so similarity is 1 - distance.
        score: 1 - vector.distance,
        text,
        title,
        section,
        path,
        updated,
        kind,
        ...(url === undefined ? {} : { sourceUrl: url }),
      });
    }

    // Order is ours, not the service's: score descending, then chunk id, so results are deterministic.
    matches.sort(
      (a, b) =>
        b.score - a.score ||
        (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0),
    );
    return { ok: true, matches: matches.slice(0, request.topK), dropped };
  }
}
