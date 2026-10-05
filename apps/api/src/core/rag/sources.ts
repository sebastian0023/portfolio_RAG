import type { IndexMatch, SourceCitation } from '@portfolio/shared';
import { MAX_EXCERPT_CHARS, isAllowedSourceUrl } from '@portfolio/shared';
import { highlightRanges } from './highlights.js';

// Builds the source cards from retrieval, never from model output (ADR-048): the model can only write `[n]`, so
// an injected instruction cannot forge a title, an excerpt, or a link. `evidence` is already numbered by position.
export function toSourceCitations(
  evidence: readonly IndexMatch[],
  question: string,
): SourceCitation[] {
  return evidence.map((match, index): SourceCitation => {
    const excerpt = match.text.slice(0, MAX_EXCERPT_CHARS);
    return {
      n: index + 1,
      chunkId: match.chunkId,
      sourceId: match.sourceId,
      // Checked again here: the allowlist is the last thing between a stored URL and a visitor's click (R-17).
      ...(match.sourceUrl !== undefined && isAllowedSourceUrl(match.sourceUrl)
        ? { sourceUrl: match.sourceUrl }
        : {}),
      title: match.title,
      section: match.section,
      path: match.path,
      updated: match.updated,
      excerpt,
      highlights: highlightRanges(excerpt, question),
    };
  });
}
