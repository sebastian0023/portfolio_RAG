import type {
  InvokeModelCommand,
  InvokeModelCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, test } from 'vitest';
import {
  RAW_EMBED_DETAIL,
  runEmbedderContract,
} from '../../testing/embedder-contract.js';
import {
  TitanEmbedder,
  type BedrockInvokeClientLike,
} from './titan-embedder.js';

const vector = (): number[] =>
  Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0));
const body = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value));

class FakeBedrock {
  readonly commands: InvokeModelCommand[] = [];
  failure: string | undefined;
  reply: unknown = { embedding: vector(), inputTextTokenCount: 4 };
  raw: Uint8Array | undefined;

  send = ((command: InvokeModelCommand) => {
    this.commands.push(command);
    if (this.failure !== undefined) {
      return Promise.reject(
        Object.assign(new Error(RAW_EMBED_DETAIL), { name: this.failure }),
      );
    }
    return Promise.resolve({
      $metadata: {},
      body: this.raw ?? body(this.reply),
    } as InvokeModelCommandOutput);
  }) satisfies BedrockInvokeClientLike['send'];
}

const NAMES = {
  throttled: 'ThrottlingException',
  unavailable: 'ServiceUnavailableException',
  internal: 'SomethingUnexpected',
} as const;

runEmbedderContract('Titan adapter with a fake client', {
  build(scenario) {
    const fake = new FakeBedrock();
    if (scenario.kind === 'error') fake.failure = NAMES[scenario.code];
    return {
      embedder: new TitanEmbedder(fake),
      calls: () => fake.commands.length,
    };
  },
});

describe('Titan adapter specifics', () => {
  test('sends the configured model, dimensions, and normalization', async () => {
    const fake = new FakeBedrock();
    await new TitanEmbedder(fake).embed('hello there');
    const input = fake.commands[0]?.input;
    expect(input?.modelId).toBe('amazon.titan-embed-text-v2:0');
    expect(JSON.parse(String(input?.body))).toEqual({
      inputText: 'hello there',
      dimensions: 512,
      normalize: true,
    });
  });

  test('reports the input token count', async () => {
    const fake = new FakeBedrock();
    expect(await new TitanEmbedder(fake).embed('hello there')).toMatchObject({
      ok: true,
      inputTokens: 4,
    });
  });

  test.each([
    [
      'a zero vector',
      { embedding: new Array<number>(512).fill(0), inputTextTokenCount: 1 },
    ],
    ['a short vector', { embedding: [1, 2, 3], inputTextTokenCount: 1 }],
    ['a missing embedding', { inputTextTokenCount: 1 }],
    [
      'a non-finite value',
      { embedding: [...vector().slice(1), null], inputTextTokenCount: 1 },
    ],
  ])('treats %s as an internal failure', async (_name, reply) => {
    const fake = new FakeBedrock();
    fake.reply = reply;
    expect(await new TitanEmbedder(fake).embed('hello there')).toEqual({
      ok: false,
      code: 'internal',
    });
  });

  test('treats a body that is not JSON as an internal failure', async () => {
    const fake = new FakeBedrock();
    fake.raw = new TextEncoder().encode('not json');
    expect(await new TitanEmbedder(fake).embed('hello there')).toEqual({
      ok: false,
      code: 'internal',
    });
  });
});
