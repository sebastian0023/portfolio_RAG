import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';
import { buildApiBundle } from '../../apps/api/scripts/build.ts';

const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'api-bundle-'));
  dirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('API Lambda bundle', () => {
  test('is byte-for-byte reproducible so CI and local plans agree', async () => {
    const first = await buildApiBundle(scratch());
    const second = await buildApiBundle(scratch());
    expect(readFileSync(first).equals(readFileSync(second))).toBe(true);
  });

  test('stays within the size budget', async () => {
    const file = await buildApiBundle(scratch());
    expect(statSync(file).size).toBeLessThan(3 * 1024 * 1024);
  });

  test('imports without network access and refuses every request while unwired', async () => {
    const written: string[] = [];
    let metadata: unknown;
    const g = globalThis as Record<string, unknown>;
    g['awslambda'] = {
      streamifyResponse: (fn: unknown) => fn,
      HttpResponseStream: {
        from: (stream: unknown, meta: unknown) => {
          metadata = meta;
          return stream;
        },
      },
    };
    try {
      const file = await buildApiBundle(scratch());
      const mod = (await import(pathToFileURL(file).href)) as {
        handler: (event: unknown, stream: unknown) => Promise<void>;
      };
      let ended = false;
      await mod.handler(
        {},
        {
          write: (chunk: string) => written.push(chunk),
          end: () => {
            ended = true;
          },
          on: () => undefined,
        },
      );
      expect(ended).toBe(true);
      expect(metadata).toMatchObject({
        statusCode: 503,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
      expect(written.join('')).toBe(
        'data: {"type":"error","error":{"code":"unavailable"}}\n\n',
      );
    } finally {
      delete g['awslambda'];
    }
  });
});
