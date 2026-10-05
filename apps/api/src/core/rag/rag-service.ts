import type { ChatStreamEvent } from '@portfolio/shared';
import { CHUNK_ID_PATTERN } from '../knowledge/config.js';
import type { Embedder, IndexRepository } from '@portfolio/shared';
import { streamAnswer } from '../chat/answer-stream.js';
import type { ChatService, ChatServiceInput } from '../chat/chat-handler.js';
import type { Logger } from '../ports/logger.js';
import { citedMarkers, coverageOf, NO_COVERAGE_TEXT } from './citations.js';
import { normalizeHistory } from './history.js';
import { PromptBuilder } from './prompt-builder.js';
import { RETRIEVAL_POLICY, topKFor } from './retrieval-policy.js';
import { toSourceCitations } from './sources.js';

export interface RagServiceDeps {
  readonly embedder: Embedder;
  readonly repository: IndexRepository;
  readonly logger: Logger;
  readonly now?: () => number;
}

// The answer path (ADR-041, ADR-054): embed the question, retrieve from the active index, then either abstain
// without calling the model or answer from the evidence:
//
//   embed -> retrieve -> threshold -> build prompt -> [accepted -> sources -> delta* -> done]
//
// Embedding, retrieval, and prompt-budget failures happen before `accepted`, so the handler turns them into a
// 503 and the visitor never gets an answer without sources. One deadline covers every step.
export function createRagService(deps: RagServiceDeps): ChatService {
  const now = deps.now ?? Date.now;

  return {
    async *stream(input: ChatServiceInput): AsyncGenerator<ChatStreamEvent> {
      const { request, config, signal, provider, quota, requestId } = input;
      const { limits } = config;
      const started = now();
      const combined = AbortSignal.any([
        signal,
        AbortSignal.timeout(limits.timeoutSeconds * 1000),
      ]);
      const refuse = (errorCode: string): void => {
        deps.logger.log({
          requestId,
          stage: 'retrieval',
          outcome: 'failed',
          errorCode,
          index: config.activeIndex,
          latencyMs: now() - started,
        });
      };

      // Only the question is embedded, never the history, so a follow-up that depends on context retrieves
      // poorly. Phase 6 evals measure that (ADR-054).
      const embedded = await deps.embedder.embed(request.question, combined);
      if (!embedded.ok) {
        refuse(`embed_${embedded.code}`);
        if (!signal.aborted)
          yield { type: 'error', error: { code: 'unavailable' } };
        return;
      }

      const found = await deps.repository.query(
        {
          index: config.activeIndex,
          vector: embedded.vector,
          topK: topKFor(limits),
          filter: RETRIEVAL_POLICY.filter,
        },
        combined,
      );
      if (!found.ok) {
        refuse(`index_${found.code}`);
        if (!signal.aborted)
          yield { type: 'error', error: { code: 'unavailable' } };
        return;
      }

      const kept = found.matches.filter(
        (m) => m.score >= RETRIEVAL_POLICY.minScore,
      );
      deps.logger.log({
        requestId,
        stage: 'retrieval',
        outcome: 'completed',
        index: config.activeIndex,
        matchCount: found.matches.length,
        keptCount: kept.length,
        droppedCount: found.dropped,
        ...(found.matches[0] === undefined
          ? {}
          : { topScore: found.matches[0].score }),
        chunkIds: kept
          .map((m) => m.chunkId)
          .filter((id) => CHUNK_ID_PATTERN.test(id)),
        embedTokens: embedded.inputTokens,
        latencyMs: now() - started,
      });

      const abstain = async function* (): AsyncGenerator<ChatStreamEvent> {
        yield { type: 'accepted', quota };
        yield { type: 'delta', text: NO_COVERAGE_TEXT };
        yield { type: 'done', coverage: 'none', cited: [] };
      };
      if (kept.length === 0) {
        yield* abstain();
        return;
      }

      const built = new PromptBuilder({
        promptMaxTokens: limits.promptMaxTokens,
        chunkMaxTokens: limits.chunkMaxTokens,
        outputMaxTokens: limits.outputMaxTokens,
      })
        .history(normalizeHistory(request.history, limits.historyTurns))
        .evidence(kept)
        .question(request.question)
        .build();
      if (!built.ok) {
        if (built.reason === 'no_evidence') {
          yield* abstain();
        } else {
          refuse('prompt_over_budget');
          yield { type: 'error', error: { code: 'unavailable' } };
        }
        return;
      }

      const sources = toSourceCitations(built.evidence, request.question);
      yield* streamAnswer({
        logger: deps.logger,
        ...(deps.now === undefined ? {} : { now: deps.now }),
        requestId,
        provider,
        request: built.request,
        viewer: signal,
        signal: combined,
        quota,
        afterAccepted: [{ type: 'sources', sources }],
        finish: (answer) => {
          const cited = citedMarkers(answer);
          const unmatched = cited.filter((n) => n < 1 || n > sources.length);
          deps.logger.log({
            requestId,
            stage: 'retrieval',
            outcome: 'completed',
            index: config.activeIndex,
            citedCount: cited.length,
            unmatchedCitations: unmatched.length,
          });
          return { coverage: coverageOf(answer, cited, sources.length), cited };
        },
      });
    },
  };
}
