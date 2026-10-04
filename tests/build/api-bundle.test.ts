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

  test('imports without network access and refuses a wrong content type before any config load', async () => {
    const written: string[] = [];
    let metadata: unknown;
    const g = globalThis as Record<string, unknown>;
    const env = {
      APP_ENV: 'production',
      PARAMETER_PREFIX: '/portfolio-v2/prod',
      COUNTERS_TABLE: 'portfolio-v2-prod-counters',
      AWS_REGION: 'us-east-1',
    };
    const saved = Object.fromEntries(
      Object.keys(env).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, env);
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
        {
          rawPath: '/api/chat',
          headers: { host: 'example.test', 'content-type': 'text/plain' },
          requestContext: { http: { method: 'POST' } },
          body: 'hi',
        },
        {
          write: (chunk: Uint8Array) =>
            written.push(new TextDecoder().decode(chunk)),
          end: () => {
            ended = true;
          },
          on: () => undefined,
        },
      );
      expect(ended).toBe(true);
      expect(metadata).toMatchObject({
        statusCode: 415,
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
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('refuses to initialise outside the production environment', async () => {
    const g = globalThis as Record<string, unknown>;
    g['awslambda'] = {
      streamifyResponse: (fn: unknown) => fn,
      HttpResponseStream: { from: (stream: unknown) => stream },
    };
    const saved = process.env['APP_ENV'];
    process.env['APP_ENV'] = 'test';
    try {
      const file = await buildApiBundle(scratch());
      await expect(import(pathToFileURL(file).href)).rejects.toThrow();
    } finally {
      delete g['awslambda'];
      if (saved === undefined) delete process.env['APP_ENV'];
      else process.env['APP_ENV'] = saved;
    }
  });
});
