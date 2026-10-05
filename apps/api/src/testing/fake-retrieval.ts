import type { SourceKind } from '@portfolio/shared';
import { FakeEmbedder, fakeVectorFor } from './fake-embedder.js';
import { InMemoryIndexRepository } from './in-memory-index-repository.js';

export const DEFAULT_INDEX = 'chunks-0123456789abcdef';

export interface Passage {
  readonly id: string;
  readonly text: string;
  readonly title?: string;
  readonly kind?: SourceKind;
  readonly sourceUrl?: string;
}

// A retrieval stack for tests: passages are indexed with the vectors the fake embedder would produce for their
// text, so a question that shares words with a passage retrieves it and an unrelated one retrieves nothing useful.
export function fakeRetrieval(
  passages: readonly Passage[],
  index: string = DEFAULT_INDEX,
) {
  const embedder = new FakeEmbedder();
  const repository = new InMemoryIndexRepository().addIndex(
    index,
    passages.map((p) => ({
      chunkId: `${p.id}#section-1`,
      sourceId: p.id,
      kind: p.kind ?? 'faq',
      lang: 'en' as const,
      updated: '2026-01-01',
      title: p.title ?? `Title of ${p.id}`,
      section: 'Section',
      path: `knowledge/${p.id}.md`,
      text: p.text,
      ...(p.sourceUrl === undefined ? {} : { sourceUrl: p.sourceUrl }),
      vector: fakeVectorFor(p.text) ?? [],
    })),
  );
  return { embedder, repository };
}

// A passage and a question that retrieve each other under the fake embedder.
export const STUDY_PASSAGE: Passage = {
  id: 'edu-overview',
  text: 'Alex studied databases and distributed systems at Example University.',
  title: 'Education',
};
export const STUDY_QUESTION =
  'What databases and distributed systems did Alex study?';
export const OFF_TOPIC_QUESTION =
  'Which hiking trails have printable elevation maps?';
