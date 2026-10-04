import type {
  ConverseStreamCommand,
  ConverseStreamCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, test } from 'vitest';
import {
  RAW_DETAIL,
  runLlmProviderContract,
  type Built,
  type Observed,
  type Scenario,
} from '../../testing/llm-provider-contract.js';
import {
  createBedrockConverseProvider,
  type BedrockClientLike,
} from './bedrock-converse-provider.js';

const MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

class NamedError extends Error {
  constructor(name: string) {
    super(RAW_DETAIL);
    this.name = name;
  }
}

const abortError = () => new NamedError('AbortError');

const ERROR_NAMES = {
  throttled: 'ThrottlingException',
  unavailable: 'ServiceUnavailableException',
  invalid_request: 'ValidationException',
  internal: 'SomethingUnexpected',
} as const;

type Raw = Record<string, unknown>;

async function* streamOf(
  events: Raw[],
  options: { hangAfterFirst?: AbortSignal | undefined } = {},
): AsyncGenerator<Raw> {
  await Promise.resolve();
  for (const [index, event] of events.entries()) {
    yield event;
    const signal = options.hangAfterFirst;
    if (index === 0 && signal) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      throw abortError();
    }
  }
}

const delta = (text: string): Raw => ({
  contentBlockDelta: { contentBlockIndex: 0, delta: { text } },
});

function scripted(events: Raw[], hang = false) {
  let calls = 0;
  let command: ConverseStreamCommand | undefined;
  const client: BedrockClientLike = {
    send(cmd, options) {
      calls += 1;
      command = cmd;
      return Promise.resolve({
        stream: streamOf(
          events,
          hang ? { hangAfterFirst: options?.abortSignal } : {},
        ),
        $metadata: {},
      } as unknown as ConverseStreamCommandOutput);
    },
  };
  return { client, calls: () => calls, command: () => command };
}

function build(scenario: Scenario): Built {
  let calls = 0;
  let command: ConverseStreamCommand | undefined;

  if (scenario.kind === 'error' && scenario.code === 'content_filtered') {
    return wrap(
      scripted([
        { messageStop: { stopReason: 'content_filtered' } },
        { metadata: { usage: { inputTokens: 1, outputTokens: 0 } } },
      ]),
    );
  }
  if (scenario.kind === 'error') {
    const name = ERROR_NAMES[scenario.code as keyof typeof ERROR_NAMES];
    const client: BedrockClientLike = {
      send(cmd) {
        calls += 1;
        command = cmd;
        return Promise.reject(new NamedError(name));
      },
    };
    return {
      provider: createBedrockConverseProvider(client, MODEL),
      calls: () => calls,
      observed: () => observe(command),
    };
  }
  if (scenario.kind === 'hang') {
    return wrap(scripted([delta('partial')], true));
  }
  const events: Raw[] = [
    { messageStart: { role: 'assistant' } },
    ...scenario.chunks.map(delta),
    { contentBlockStop: { contentBlockIndex: 0 } },
    {
      messageStop: {
        stopReason: scenario.stop === 'max_tokens' ? 'max_tokens' : 'end_turn',
      },
    },
    ...(scenario.usage
      ? [
          {
            metadata: {
              usage: { ...scenario.usage, totalTokens: 99 },
              metrics: {},
            },
          },
        ]
      : []),
  ];
  return wrap(scripted(events));

  function wrap(s: ReturnType<typeof scripted>): Built {
    return {
      provider: createBedrockConverseProvider(s.client, MODEL),
      calls: s.calls,
      observed: () => observe(s.command()),
    };
  }
}

function observe(
  command: ConverseStreamCommand | undefined,
): Observed | undefined {
  const input = command?.input;
  if (!input) return undefined;
  return {
    maxOutputTokens: input.inferenceConfig?.maxTokens,
    systemPrompt:
      input.system?.[0] && 'text' in input.system[0]
        ? input.system[0].text
        : undefined,
    messages: (input.messages ?? []).map((m) => ({
      role: m.role ?? '',
      text:
        m.content?.[0] && 'text' in m.content[0]
          ? (m.content[0].text ?? '')
          : '',
    })),
  };
}

runLlmProviderContract('bedrock converse', { build });

describe('bedrock converse specifics', () => {
  const request = {
    systemPrompt: 's',
    history: [],
    userMessage: 'q',
    maxOutputTokens: 400,
  };
  const run = async (events: Raw[]) => {
    const out = [];
    for await (const e of createBedrockConverseProvider(
      scripted(events).client,
      MODEL,
    ).stream(request)) {
      out.push(e);
    }
    return out;
  };

  test('targets the configured model id', async () => {
    const s = scripted([{ messageStop: { stopReason: 'end_turn' } }]);
    for await (const e of createBedrockConverseProvider(s.client, MODEL).stream(
      request,
    ))
      void e;
    expect(s.command()?.input.modelId).toBe(MODEL);
  });

  test('holds usage back so it precedes done even though Bedrock sends it last', async () => {
    const events = await run([
      delta('a'),
      { messageStop: { stopReason: 'end_turn' } },
      { metadata: { usage: { inputTokens: 5, outputTokens: 1 } } },
    ]);
    expect(events.map((e) => e.type)).toEqual(['delta', 'usage', 'done']);
  });

  test('a malformed event of a used kind becomes an internal error', async () => {
    const events = await run([{ contentBlockDelta: { delta: { text: 42 } } }]);
    expect(events).toEqual([
      { type: 'error', error: { code: 'internal', retryable: false } },
    ]);
  });

  test('ignores event kinds it does not use', async () => {
    const events = await run([
      { somethingNew: { x: 1 } },
      { messageStop: { stopReason: 'end_turn' } },
    ]);
    expect(events).toEqual([{ type: 'done', stopReason: 'end' }]);
  });

  test('maps an in-stream exception event without forwarding its payload', async () => {
    const events = await run([
      delta('a'),
      { throttlingException: { message: RAW_DETAIL } },
    ]);
    expect(events).toEqual([
      { type: 'delta', text: 'a' },
      { type: 'error', error: { code: 'throttled', retryable: true } },
    ]);
    expect(JSON.stringify(events)).not.toContain(RAW_DETAIL);
  });

  test('treats guardrail and unknown stop reasons as errors', async () => {
    expect(
      await run([{ messageStop: { stopReason: 'guardrail_intervened' } }]),
    ).toEqual([
      { type: 'error', error: { code: 'content_filtered', retryable: false } },
    ]);
    expect(await run([{ messageStop: { stopReason: 'tool_use' } }])).toEqual([
      { type: 'error', error: { code: 'internal', retryable: false } },
    ]);
  });

  test('a stream that ends without a stop reason is an unavailable error', async () => {
    expect(await run([delta('a')])).toEqual([
      { type: 'delta', text: 'a' },
      { type: 'error', error: { code: 'unavailable', retryable: true } },
    ]);
  });

  test('an AccessDenied (kill switch) reads as unavailable and is not retryable', async () => {
    const client: BedrockClientLike = {
      send: () => Promise.reject(new NamedError('AccessDeniedException')),
    };
    const out = [];
    for await (const e of createBedrockConverseProvider(client, MODEL).stream(
      request,
    ))
      out.push(e);
    expect(out).toEqual([
      { type: 'error', error: { code: 'unavailable', retryable: false } },
    ]);
  });
});
