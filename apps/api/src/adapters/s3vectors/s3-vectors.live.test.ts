import {
  ListVectorsCommand,
  QueryVectorsCommand,
  S3VectorsClient,
} from '@aws-sdk/client-s3vectors';
import { describe, expect, test } from 'vitest';

// Live run against the real service (P5-07). Fake-client tests do not prove service limits or the cosine
// distance formula (ADR-038), so the owner runs this once, as the eval role, against a complete candidate index:
//
//   S3VECTORS_LIVE=1 AWS_REGION=us-east-1 VECTOR_BUCKET=portfolio-v2-prod-vectors LIVE_INDEX=chunks-<hash> \
//     npx vitest run s3-vectors.live
//
// It is read-only. It reads one stored vector, then pins what the adapter assumes: a vector queried against itself
// has distance 0, and an orthogonal query has distance 1, so `score = 1 - distance` is cosine similarity.
const live = process.env['S3VECTORS_LIVE'] === '1';

describe.skipIf(!live)('S3 Vectors live: cosine distance', () => {
  const bucket = process.env['VECTOR_BUCKET'] ?? '';
  const index = process.env['LIVE_INDEX'] ?? '';
  const client = new S3VectorsClient({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
  });

  const query = async (vector: number[]) => {
    const out = await client.send(
      new QueryVectorsCommand({
        vectorBucketName: bucket,
        indexName: index,
        topK: 100,
        queryVector: { float32: vector },
        returnDistance: true,
      }),
    );
    expect(out.distanceMetric).toBe('cosine');
    return new Map((out.vectors ?? []).map((v) => [v.key, v.distance]));
  };

  test('an identical vector has distance 0 and an orthogonal one has distance 1', async () => {
    expect(bucket).not.toBe('');
    expect(index).toMatch(/^chunks-[0-9a-f]{16}$/);

    const listed = await client.send(
      new ListVectorsCommand({
        vectorBucketName: bucket,
        indexName: index,
        maxResults: 1,
        returnData: true,
      }),
    );
    const stored = listed.vectors?.[0];
    const key = stored?.key;
    const data = stored?.data;
    if (key === undefined || data === undefined || !('float32' in data)) {
      throw new Error('the index has no readable vector');
    }
    const v = data.float32 ?? [];

    const same = await query(v);
    expect(same.get(key)).toBeCloseTo(0, 4);

    // Gram-Schmidt: take the axis where v is smallest and remove its component along v.
    const norm = Math.hypot(...v);
    const unitV = v.map((x) => x / norm);
    const axis = unitV.reduce(
      (best, x, i) => (Math.abs(x) < Math.abs(unitV[best] ?? 1) ? i : best),
      0,
    );
    const along = unitV[axis] ?? 0;
    const w = unitV.map((x, i) => (i === axis ? 1 : 0) - along * x);
    const wn = Math.hypot(...w);
    const orthogonal = await query(w.map((x) => x / wn));
    const distance = orthogonal.get(key);
    expect(
      distance,
      'the stored vector should be within the top 100',
    ).toBeDefined();
    expect(distance).toBeCloseTo(1, 3);
  });
});
