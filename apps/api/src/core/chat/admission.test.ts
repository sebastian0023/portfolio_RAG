import { describe, expect, test } from 'vitest';
import { configFrom, context, rawConfig } from '../../testing/helpers.js';
import {
  byteCapStage,
  configStage,
  contentTypeStage,
  runAdmission,
  schemaStage,
  type AdmissionStage,
} from './admission.js';

const chain = (config = configFrom(rawConfig())) => [
  contentTypeStage,
  byteCapStage,
  schemaStage,
  configStage(config),
];

describe('admission chain (ADR-016, ADR-039)', () => {
  test('admits a valid request and fills in the parsed request and config', async () => {
    const ctx = context({ json: { question: '  hello  ', history: [] } });
    expect(await runAdmission(chain(), ctx)).toBeUndefined();
    expect(ctx.request?.question).toBe('hello');
    expect(ctx.config?.limits.outputMaxTokens).toBe(400);
  });

  test('refuses another content type with 415', async () => {
    const ctx = context({ contentType: 'text/plain' });
    expect(await runAdmission(chain(), ctx)).toMatchObject({ status: 415 });
  });

  test('accepts a content type with parameters', async () => {
    const ctx = context({ contentType: 'Application/JSON; charset=utf-8' });
    expect(await runAdmission(chain(), ctx)).toBeUndefined();
  });

  test('refuses a body over 8 KB with 413 without reading all of it', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(4096));
        if (pulled > 50) controller.close();
      },
    });
    const rejection = await runAdmission(chain(), context({ body }));
    expect(rejection).toMatchObject({ status: 413, code: 'too_long' });
    expect(pulled).toBeLessThan(10);
  });

  test('refuses a missing body, bad JSON, and a schema violation with 400', async () => {
    expect(await runAdmission(chain(), context({ body: null }))).toMatchObject({
      status: 400,
    });
    expect(
      await runAdmission(
        chain(),
        context({ json: undefined, body: new Blob(['{nope']).stream() }),
      ),
    ).toMatchObject({ status: 400, code: 'unavailable' });
    for (const json of [
      { question: 'x' },
      { question: 'x', history: [], extra: 1 },
      { question: 'x', history: [{ role: 'system', text: 'y' }] },
      { question: '   ', history: [] },
    ]) {
      expect(await runAdmission(chain(), context({ json }))).toMatchObject({
        status: 400,
        code: 'unavailable',
      });
    }
  });

  test('refuses history over the server ceilings', async () => {
    const many = Array.from({ length: 21 }, () => ({
      role: 'user',
      text: 'a',
    }));
    expect(
      await runAdmission(
        chain(),
        context({ json: { question: 'x', history: many } }),
      ),
    ).toMatchObject({ status: 400 });
    const long = [{ role: 'user', text: 'a'.repeat(4001) }];
    expect(
      await runAdmission(
        chain(),
        context({ json: { question: 'x', history: long } }),
      ),
    ).toMatchObject({ status: 400 });
  });

  test('refuses a question over 500 characters as too_long (400)', async () => {
    const json = { question: 'q'.repeat(501), history: [] };
    expect(await runAdmission(chain(), context({ json }))).toMatchObject({
      status: 400,
      code: 'too_long',
    });
    const exact = { question: 'q'.repeat(500), history: [] };
    expect(
      await runAdmission(chain(), context({ json: exact })),
    ).toBeUndefined();
  });

  test('re-checks the question against the operator-set limit', async () => {
    const limits = JSON.stringify({
      ...JSON.parse(rawConfig()['limits'] as string),
      questionMaxChars: 10,
    });
    const config = configFrom(rawConfig({ limits }));
    const json = { question: 'q'.repeat(11), history: [] };
    expect(await runAdmission(chain(config), context({ json }))).toMatchObject({
      code: 'too_long',
    });
  });

  test('fails closed when config is missing, invalid, or unreadable', async () => {
    const missing = configFrom({} as Record<string, string>);
    expect(await runAdmission(chain(missing), context())).toMatchObject({
      status: 503,
      code: 'unavailable',
    });
    const invalid = configFrom(rawConfig({ llm_config: '{"provider":"x"}' }));
    expect(await runAdmission(chain(invalid), context())).toMatchObject({
      status: 503,
    });
    const broken = configFrom(() => Promise.reject(new Error('ssm down')));
    expect(await runAdmission(chain(broken), context())).toMatchObject({
      status: 503,
    });
  });

  test('the first rejection stops every later stage', async () => {
    const calls: string[] = [];
    const stage =
      (name: string, rejects: boolean): AdmissionStage =>
      () => {
        calls.push(name);
        return Promise.resolve(
          rejects ? { code: 'unavailable', status: 503 } : undefined,
        );
      };
    await runAdmission(
      [stage('a', false), stage('b', true), stage('c', false)],
      context(),
    );
    expect(calls).toEqual(['a', 'b']);
  });

  test('a rejected request never loads config', async () => {
    let loads = 0;
    const config = configFrom(() => {
      loads += 1;
      return Promise.reject(new Error('should not load'));
    });
    await runAdmission(chain(config), context({ contentType: 'text/plain' }));
    await runAdmission(
      chain(config),
      context({ json: { question: '', history: [] } }),
    );
    expect(loads).toBe(0);
  });
});
