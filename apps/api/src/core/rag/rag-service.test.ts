import type {
  ChatStreamEvent,
  Embedder,
  EmbedResult,
  IndexQueryResult,
  IndexRepository,
  LLMEvent,
} from '@portfolio/shared';
import { chatStreamEventSchema } from '@portfolio/shared/chat-stream-schema';
import { describe, expect, test } from 'vitest';
import { FakeEmbedder } from '../../testing/fake-embedder.js';
import {
  OFF_TOPIC_QUESTION,
  STUDY_PASSAGE,
  STUDY_QUESTION,
  fakeRetrieval,
  type Passage,
} from '../../testing/fake-retrieval.js';
import { scriptedProvider } from '../../testing/fake-llm-provider.js';
import { memoryLogger, rawConfig } from '../../testing/helpers.js';
import { parseRuntimeConfig } from '../config/runtime-config.js';
import { GROUNDED_SYSTEM_PROMPT } from './grounded-prompt.js';
import { NO_COVERAGE_TEXT } from './citations.js';
import { createRagService } from './rag-service.js';

const ANSWER = (text: string): LLMEvent[] => [
  { type: 'delta', text },
  { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } },
  { type: 'done', stopReason: 'end' },
];

function configWith(limits: Record<string, number> = {}) {
  const base = JSON.parse(rawConfig()['limits'] as string) as Record<
    string,
    number
  >;
  const parsed = parseRuntimeConfig(
    rawConfig({ limits: JSON.stringify({ ...base, ...limits }) }),
  );
  if (!parsed.ok) throw new Error('config must parse');
  return parsed.config;
}

interface Setup {
  readonly passages?: readonly Passage[];
  readonly events?: readonly LLMEvent[];
  readonly limits?: Record<string, number>;
  readonly embedder?: Embedder;
  readonly repository?: IndexRepository;
}

function setup(options: Setup = {}) {
  const retrieval = fakeRetrieval(options.passages ?? [STUDY_PASSAGE]);
  const provider = scriptedProvider(
    options.events ?? ANSWER('Alex studied databases [1].'),
  );
  const logger = memoryLogger();
  const service = createRagService({
    embedder: options.embedder ?? retrieval.embedder,
    repository: options.repository ?? retrieval.repository,
    logger,
  });
  const run = async (
    question = STUDY_QUESTION,
    extra: {
      history?: { role: 'user' | 'assistant'; text: string }[];
      signal?: AbortSignal;
    } = {},
  ) => {
    const events: ChatStreamEvent[] = [];
    for await (const event of service.stream({
      request: { question, history: extra.history ?? [] },
      config: configWith(options.limits),
      signal: extra.signal ?? new AbortController().signal,
      provider,
      quota: { left: 9, limit: 10 },
      requestId: 'req-1',
    })) {
      events.push(event);
    }
    return events;
  };
  return { run, provider, logger, retrieval };
}

const types = (events: ChatStreamEvent[]) => events.map((e) => e.type);

describe('RagService: grounded answers', () => {
  test('streams accepted, sources, deltas, then done with the markers the model wrote', async () => {
    const s = setup();
    const events = await s.run();
    expect(types(events)).toEqual(['accepted', 'sources', 'delta', 'done']);
    expect(events[0]).toEqual({
      type: 'accepted',
      quota: { left: 9, limit: 10 },
    });
    const sources = events[1];
    expect(sources).toMatchObject({
      type: 'sources',
      sources: [
        { n: 1, chunkId: 'edu-overview#section-1', title: 'Education' },
      ],
    });
    expect(events.at(-1)).toEqual({
      type: 'done',
      coverage: 'answered',
      cited: [1],
    });
    for (const event of events) {
      expect(chatStreamEventSchema.safeParse(event).success).toBe(true);
    }
  });

  test('sends the model the grounded policy and the evidence as data, not the old plain prompt', async () => {
    const s = setup();
    await s.run(STUDY_QUESTION, {
      history: [
        { role: 'user', text: 'Hi [3]' },
        { role: 'assistant', text: 'Hello [3].' },
      ],
    });
    const request = s.provider.requests[0];
    expect(request?.systemPrompt).toBe(GROUNDED_SYSTEM_PROMPT);
    expect(request?.userMessage).toContain('<source n="1" title="Education"');
    expect(request?.userMessage).toContain(
      'Alex studied databases and distributed systems',
    );
    expect(request?.history.map((t) => t.text)).toEqual([
      'Hi (3)',
      'Hello (3).',
    ]);
    expect(request?.maxOutputTokens).toBe(400);
  });

  test('reports every marker the model wrote, including a fabricated one', async () => {
    const s = setup({ events: ANSWER('Yes [1] and also [9].') });
    expect((await s.run()).at(-1)).toEqual({
      type: 'done',
      coverage: 'answered',
      cited: [1, 9],
    });
  });

  test('an answer that cites only a source that does not exist is not coverage', async () => {
    const s = setup({ events: ANSWER('Trust me [9].') });
    expect((await s.run()).at(-1)).toEqual({
      type: 'done',
      coverage: 'none',
      cited: [9],
    });
  });

  test('the model abstaining with the exact text is none', async () => {
    const s = setup({ events: ANSWER(NO_COVERAGE_TEXT) });
    expect((await s.run()).at(-1)).toEqual({
      type: 'done',
      coverage: 'none',
      cited: [],
    });
  });

  test('never sends more than five sources, whatever the limit allows', async () => {
    const passages: Passage[] = Array.from({ length: 10 }, (_, i) => ({
      id: `edu-part-${i}`,
      text: `Alex studied databases and distributed systems part ${i} at Example University.`,
    }));
    const s = setup({ passages, limits: { retrievedChunks: 20 } });
    const events = await s.run();
    const sources = events.find((e) => e.type === 'sources');
    expect(sources?.type === 'sources' && sources.sources).toHaveLength(5);
    expect(chatStreamEventSchema.safeParse(sources).success).toBe(true);
  });

  test('a lower limit lowers the count', async () => {
    const passages: Passage[] = Array.from({ length: 4 }, (_, i) => ({
      id: `edu-part-${i}`,
      text: `Alex studied databases and distributed systems part ${i} at Example University.`,
    }));
    const s = setup({ passages, limits: { retrievedChunks: 2 } });
    const sources = (await s.run()).find((e) => e.type === 'sources');
    expect(sources?.type === 'sources' && sources.sources).toHaveLength(2);
  });
});

describe('RagService: abstention', () => {
  test('with nothing above the threshold it answers with the fixed text and never calls the model', async () => {
    const s = setup();
    const events = await s.run(OFF_TOPIC_QUESTION);
    expect(events).toEqual([
      { type: 'accepted', quota: { left: 9, limit: 10 } },
      { type: 'delta', text: NO_COVERAGE_TEXT },
      { type: 'done', coverage: 'none', cited: [] },
    ]);
    expect(s.provider.requests).toHaveLength(0);
  });

  test('an empty index abstains too', async () => {
    const s = setup({ passages: [] });
    expect((await s.run()).at(-1)).toEqual({
      type: 'done',
      coverage: 'none',
      cited: [],
    });
    expect(s.provider.requests).toHaveLength(0);
  });
});

describe('RagService: failures before the answer begins', () => {
  const failingEmbedder = (
    code: Extract<EmbedResult, { ok: false }>['code'],
  ): Embedder => ({
    config: new FakeEmbedder().config,
    embed: () => Promise.resolve({ ok: false, code }),
  });
  const failingIndex = (
    code: Extract<IndexQueryResult, { ok: false }>['code'],
  ): IndexRepository => ({
    query: () => Promise.resolve({ ok: false, code }),
  });

  test.each([
    'throttled',
    'unavailable',
    'internal',
    'invalid_request',
  ] as const)(
    'an embedding failure (%s) is one unavailable error, before accepted',
    async (code) => {
      const s = setup({ embedder: failingEmbedder(code) });
      expect(await s.run()).toEqual([
        { type: 'error', error: { code: 'unavailable' } },
      ]);
      expect(s.provider.requests).toHaveLength(0);
    },
  );

  test.each(['not_found', 'throttled', 'unavailable', 'internal'] as const)(
    'an index failure (%s) is one unavailable error, before accepted',
    async (code) => {
      const s = setup({ repository: failingIndex(code) });
      expect(await s.run()).toEqual([
        { type: 'error', error: { code: 'unavailable' } },
      ]);
      expect(s.provider.requests).toHaveLength(0);
    },
  );

  test('a prompt that cannot fit the budget is refused, not truncated into nonsense', async () => {
    const s = setup({ limits: { promptMaxTokens: 1 } });
    expect(await s.run()).toEqual([
      { type: 'error', error: { code: 'unavailable' } },
    ]);
    expect(s.provider.requests).toHaveLength(0);
  });

  test('a model that fails immediately is one unavailable error with no sources and no accepted', async () => {
    const s = setup({
      events: [
        { type: 'error', error: { code: 'unavailable', retryable: true } },
      ],
    });
    expect(await s.run()).toEqual([
      { type: 'error', error: { code: 'unavailable' } },
    ]);
  });

  test('a viewer who left during retrieval gets nothing, and the model is never called', async () => {
    const controller = new AbortController();
    const embedder: Embedder = {
      config: new FakeEmbedder().config,
      embed: () => {
        controller.abort();
        return Promise.resolve({ ok: false, code: 'cancelled' });
      },
    };
    const s = setup({ embedder });
    expect(await s.run(STUDY_QUESTION, { signal: controller.signal })).toEqual(
      [],
    );
    expect(s.provider.requests).toHaveLength(0);
  });

  // AbortSignal.timeout uses a timer that fake timers do not patch, so this one test waits out a real 1 second.
  test('one deadline covers retrieval: a hanging embedding ends in unavailable, not a hung request', async () => {
    const embedder: Embedder = {
      config: new FakeEmbedder().config,
      embed: (_text, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener(
            'abort',
            () => resolve({ ok: false, code: 'cancelled' }),
            { once: true },
          );
        }),
    };
    const s = setup({ embedder, limits: { timeoutSeconds: 1 } });
    const started = Date.now();
    expect(await s.run()).toEqual([
      { type: 'error', error: { code: 'unavailable' } },
    ]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(s.provider.requests).toHaveLength(0);
  });
});

describe('RagService: after the answer begins', () => {
  test('a provider failure mid-answer is an interruption', async () => {
    const s = setup({
      events: [
        { type: 'delta', text: 'Alex studied ' },
        { type: 'error', error: { code: 'unavailable', retryable: true } },
      ],
    });
    const events = await s.run();
    expect(types(events)).toEqual(['accepted', 'sources', 'delta', 'error']);
    expect(events.at(-1)).toEqual({
      type: 'error',
      error: { code: 'interrupted' },
    });
  });
});

describe('RagService: logging (ADR-028)', () => {
  test('logs counts, scores, and safe chunk ids, never the question, titles, or text', async () => {
    const question =
      'What databases and distributed systems did Alex study? CANARY-QUESTION';
    const s = setup({
      passages: [
        {
          ...STUDY_PASSAGE,
          title: 'CANARY-TITLE',
          text: `${STUDY_PASSAGE.text} CANARY-TEXT`,
        },
      ],
    });
    await s.run(question);
    const retrieval = s.logger.events.filter((e) => e.stage === 'retrieval');
    expect(retrieval.length).toBeGreaterThanOrEqual(2);
    expect(retrieval[0]).toMatchObject({
      outcome: 'completed',
      index: 'chunks-0123456789abcdef',
      matchCount: 1,
      keptCount: 1,
      droppedCount: 0,
      chunkIds: ['edu-overview#section-1'],
    });
    expect(retrieval.at(-1)).toMatchObject({
      citedCount: 1,
      unmatchedCitations: 0,
    });
    const logged = JSON.stringify(s.logger.events);
    for (const canary of ['CANARY-QUESTION', 'CANARY-TITLE', 'CANARY-TEXT']) {
      expect(logged).not.toContain(canary);
    }
  });

  test('a retrieval failure logs the reason code only', async () => {
    const s = setup({
      repository: {
        query: () => Promise.resolve({ ok: false, code: 'unavailable' }),
      },
    });
    await s.run();
    expect(s.logger.events.find((e) => e.stage === 'retrieval')).toMatchObject({
      outcome: 'failed',
      errorCode: 'index_unavailable',
    });
  });

  test('counts unmatched citations', async () => {
    const s = setup({ events: ANSWER('Yes [1] [7] [8].') });
    await s.run();
    expect(
      s.logger.events.filter((e) => e.stage === 'retrieval').at(-1),
    ).toMatchObject({
      citedCount: 3,
      unmatchedCitations: 2,
    });
  });
});
