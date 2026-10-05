import type { HighlightRange } from '@portfolio/shared';

// Highlights are chosen from the question, not the answer: the `sources` event is sent before the answer exists
// (ADR-049). Up to two sentences with the most question terms are marked, so the viewer shows why a passage was
// retrieved.

const STOPWORDS = new Set(
  'the a an and or of to in on at for with is are was were be been do does did what which who whom how why when where about from by as it its this that these those has have had can could would should you your alex tell me'.split(
    ' ',
  ),
);

export function terms(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (word) => word.length >= 3 && !STOPWORDS.has(word),
    ),
  );
}

// Sentence spans with surrounding whitespace trimmed, so every range starts and ends on visible text.
function sentenceSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/[^.!?]+[.!?]*/g)) {
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    const start = (match.index ?? 0) + lead;
    spans.push({ start, end: start + trimmed.length });
  }
  return spans;
}

export function highlightRanges(
  excerpt: string,
  question: string,
  max = 2,
): HighlightRange[] {
  const wanted = terms(question);
  if (wanted.size === 0) return [];
  const scored = sentenceSpans(excerpt)
    .map((span, order) => {
      const found = terms(excerpt.slice(span.start, span.end));
      let score = 0;
      for (const word of wanted) if (found.has(word)) score++;
      return { ...span, score, order };
    })
    .filter((span) => span.score > 0)
    // Most overlap first; earlier sentence wins a tie, so the result is deterministic.
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, max);
  return scored
    .sort((a, b) => a.start - b.start)
    .map(({ start, end }) => ({ start, end }));
}
