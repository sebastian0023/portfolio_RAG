import type { ChatStreamEvent, LLMEvent, LLMProvider } from '@portfolio/shared';
import type { ChatService } from '../../chat/chat-handler.js';
import type { RuntimeConfig } from '../../config/runtime-config.js';
import type { EvalCase } from './dataset.js';
import {
  EVAL_POLICY_VERSION,
  collectRun,
  gate,
  scoreCase,
  summarize,
  type EvalMetrics,
} from './score.js';

export interface EvalReport {
  readonly schema: 1;
  readonly policyVersion: number;
  readonly index: string;
  // The manifest the index was built from (from evals/indexes/<index>.json), so a report cannot be reused for a
  // different build of the same name.
  readonly manifestSha256: string;
  readonly gitSha: string;
  // Canonical JSON of llm_config at the time of the run: a model change invalidates the report.
  readonly llmConfig: string;
  readonly createdAt: string;
  readonly metrics: EvalMetrics;
  readonly passed: boolean;
  readonly failures: readonly string[];
  // Results carry ids and codes only: no question text beyond the dataset id, and never an answer.
  readonly cases: readonly {
    id: string;
    kind: string;
    ok: boolean;
    failure?: string;
  }[];
}

export interface RunEvalOptions {
  readonly service: ChatService;
  readonly provider: LLMProvider;
  readonly config: RuntimeConfig;
  readonly cases: readonly EvalCase[];
  readonly meta: {
    readonly manifestSha256: string;
    readonly gitSha: string;
    readonly llmConfig: string;
    readonly now: () => Date;
  };
  readonly requestId?: string;
}

// Wraps the provider to see the real input token count of every call, so the gate can check the prompt budget
// against what the model actually billed rather than our estimate.
function observed(provider: LLMProvider, seen: { max: number }): LLMProvider {
  return {
    id: provider.id,
    async *stream(request, signal) {
      for await (const event of provider.stream(request, signal)) {
        if (event.type === 'usage') {
          seen.max = Math.max(seen.max, event.usage.inputTokens);
        }
        yield event satisfies LLMEvent;
      }
    },
  };
}

// Drives the real answer path against the index named in `config.activeIndex`, one case at a time, skipping
// admission (a gate run is not a visitor and must not spend their quota).
export async function runEval(options: RunEvalOptions): Promise<EvalReport> {
  const seen = { max: 0 };
  const provider = observed(options.provider, seen);
  const scored = [];
  for (const testCase of options.cases) {
    const events: ChatStreamEvent[] = [];
    for await (const event of options.service.stream({
      request: { question: testCase.question, history: [] },
      config: options.config,
      signal: new AbortController().signal,
      provider,
      quota: { left: 1, limit: 1 },
      requestId: options.requestId ?? `eval-${testCase.id}`,
    })) {
      events.push(event);
    }
    scored.push(scoreCase(testCase, collectRun(events)));
  }
  const metrics = summarize(scored, seen.max);
  const verdict = gate(metrics, options.config.limits.promptMaxTokens);
  return {
    schema: 1,
    policyVersion: EVAL_POLICY_VERSION,
    index: options.config.activeIndex,
    manifestSha256: options.meta.manifestSha256,
    gitSha: options.meta.gitSha,
    llmConfig: options.meta.llmConfig,
    createdAt: options.meta.now().toISOString(),
    metrics,
    passed: verdict.passed,
    failures: verdict.failures,
    cases: scored.map((r) => ({
      id: r.id,
      kind: r.kind,
      ok: r.ok,
      ...(r.failure === undefined ? {} : { failure: r.failure }),
    })),
  };
}
