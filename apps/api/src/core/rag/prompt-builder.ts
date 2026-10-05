import type { IndexMatch, LLMRequest, LLMTurn } from '@portfolio/shared';
import { GROUNDED_SYSTEM_PROMPT } from './grounded-prompt.js';
import { untrusted } from './text-safety.js';

// Builder for the grounded prompt (ADR-042). It keeps four things apart and enforces the token budget: system
// policy, history, untrusted evidence, and the question. Evidence is cut first when the budget is tight.

export interface PromptBudget {
  readonly promptMaxTokens: number;
  readonly chunkMaxTokens: number;
  readonly outputMaxTokens: number;
}

export interface BuiltPrompt {
  readonly request: LLMRequest;
  // The evidence that actually fits, numbered 1..k by position. `sources` and `[n]` both refer to this list.
  readonly evidence: readonly IndexMatch[];
  readonly estimatedTokens: number;
  // How many retrieved chunks were left out to fit the budget (or because one alone was too large).
  readonly truncated: number;
}

export type BuildFailure = 'no_evidence' | 'over_budget';

export type BuildResult =
  | ({ readonly ok: true } & BuiltPrompt)
  | { readonly ok: false; readonly reason: BuildFailure };

const encoder = new TextEncoder();
// Over-estimates for English prose (about 4 characters per token), which keeps the real count under the limit.
export const estimateTokens = (text: string): number =>
  Math.ceil(encoder.encode(text).length / 3);

function evidenceBlock(evidence: readonly IndexMatch[]): string {
  const sources = evidence.map(
    (match, i) =>
      `<source n="${i + 1}" title="${untrusted(match.title)}" section="${untrusted(match.section)}" updated="${untrusted(match.updated)}">${untrusted(match.text)}</source>`,
  );
  return `<sources>\n${sources.join('\n')}\n</sources>`;
}

export class PromptBuilder {
  readonly #budget: PromptBudget;
  #system = GROUNDED_SYSTEM_PROMPT;
  #history: readonly LLMTurn[] = [];
  #evidence: readonly IndexMatch[] = [];
  #question = '';

  constructor(budget: PromptBudget) {
    this.#budget = budget;
  }

  system(text: string): this {
    this.#system = text;
    return this;
  }

  // Already normalised to alternate roles (history.ts). Marker-like text in earlier turns is neutralised.
  history(turns: readonly LLMTurn[]): this {
    this.#history = turns.map((turn) => ({
      role: turn.role,
      text: untrusted(turn.text),
    }));
    return this;
  }

  // Best match first. Position becomes the source number.
  evidence(matches: readonly IndexMatch[]): this {
    this.#evidence = matches;
    return this;
  }

  question(text: string): this {
    this.#question = text;
    return this;
  }

  build(): BuildResult {
    const { chunkMaxTokens, promptMaxTokens, outputMaxTokens } = this.#budget;
    let evidence = this.#evidence.filter(
      (match) => estimateTokens(match.text) <= chunkMaxTokens,
    );
    let history = this.#history;

    const compose = (): { message: string; tokens: number } => {
      const message = `${evidenceBlock(evidence)}\n<question>${untrusted(this.#question)}</question>`;
      const tokens =
        estimateTokens(this.#system) +
        history.reduce((sum, turn) => sum + estimateTokens(turn.text), 0) +
        estimateTokens(message);
      return { message, tokens };
    };

    if (evidence.length === 0) return { ok: false, reason: 'no_evidence' };
    let composed = compose();
    while (composed.tokens > promptMaxTokens) {
      if (evidence.length > 1) {
        evidence = evidence.slice(0, -1);
      } else if (history.length > 0) {
        // Drop the oldest exchange, keeping the alternation that normalizeHistory guarantees.
        history = history.slice(2);
        while (history[0]?.role === 'assistant') history = history.slice(1);
      } else {
        return { ok: false, reason: 'over_budget' };
      }
      composed = compose();
    }

    return {
      ok: true,
      request: {
        systemPrompt: this.#system,
        history,
        userMessage: composed.message,
        maxOutputTokens: outputMaxTokens,
      },
      evidence,
      estimatedTokens: composed.tokens,
      truncated: this.#evidence.length - evidence.length,
    };
  }
}
