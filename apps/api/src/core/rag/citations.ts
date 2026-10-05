// The model writes `[n]` markers; the server decides what they mean (ADR-054). The browser hides any marker that
// has no matching source, so the server reports every marker the model wrote, valid or not.

const MARKER = /\[(\d{1,3})\]/g;
const MAX_DISTINCT = 20;
const MAX_MARKER = 99;

// What the server sends when nothing in the corpus answers the question (and what the model is told to say).
export const NO_COVERAGE_TEXT =
  "The public sources on this site don't cover that yet.";

// Distinct markers in order of first appearance, at most 20, each from 1 to 99.
export function citedMarkers(answer: string): number[] {
  const seen: number[] = [];
  for (const match of answer.matchAll(MARKER)) {
    const n = Number(match[1]);
    if (n < 1 || n > MAX_MARKER || seen.includes(n)) continue;
    seen.push(n);
    if (seen.length === MAX_DISTINCT) break;
  }
  return seen;
}

// `answered` only when at least one marker points at a source that was actually sent. An abstention or an answer
// that cites nothing real is `none`, so the browser offers related questions instead of a bare claim.
export function coverageOf(
  answer: string,
  cited: readonly number[],
  sourceCount: number,
): 'answered' | 'none' {
  if (answer.trim() === NO_COVERAGE_TEXT) return 'none';
  return cited.some((n) => n >= 1 && n <= sourceCount) ? 'answered' : 'none';
}
