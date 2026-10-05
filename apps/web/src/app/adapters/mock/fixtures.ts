import type { HighlightRange, SourceCitation } from '@portfolio/shared';
import {
  Q_AWS,
  Q_BEST_AT,
  Q_CONTACT,
  Q_INTERNSHIPS,
  Q_PROJECT,
  Q_STUDYING,
} from '../../content/suggestions';

// Canned corpus for the mock backend. Bracketed text is an owner placeholder, not a claim.

interface Piece {
  readonly text: string;
  readonly cited?: true;
}

function passage(pieces: readonly Piece[]): {
  excerpt: string;
  highlights: HighlightRange[];
} {
  let excerpt = '';
  const highlights: HighlightRange[] = [];
  for (const piece of pieces) {
    if (piece.cited)
      highlights.push({
        start: excerpt.length,
        end: excerpt.length + piece.text.length,
      });
    excerpt += piece.text;
  }
  return { excerpt, highlights };
}

function source(
  n: number,
  id: string,
  title: string,
  section: string,
  path: string,
  updated: string,
  pieces: readonly Piece[],
  url: boolean,
): SourceCitation {
  return {
    n,
    chunkId: `${id}#0`,
    sourceId: id,
    ...(url ? { sourceUrl: `https://example.com/${id}` } : {}),
    title,
    section,
    path,
    updated,
    ...passage(pieces),
  };
}

export const SOURCES: Readonly<Record<number, SourceCitation>> = {
  1: source(
    1,
    'education',
    'Education',
    'Systems Engineering at ITESO',
    'knowledge/education.md',
    '[Sep 12, 2026]',
    [
      {
        text: 'Daniel studies Systems Engineering at ITESO in Jalisco, Mexico. ',
        cited: true,
      },
      { text: 'Coursework includes [course], [course], and [course]. ' },
      { text: 'Expected graduation: [year].', cited: true },
    ],
    true,
  ),
  2: source(
    2,
    'skills',
    'Skills',
    'Cloud and AWS',
    'knowledge/skills.md',
    '[Sep 12, 2026]',
    [
      { text: 'Daniel focuses on software development. ', cited: true },
      {
        text: 'Day-to-day tools include [language], [framework], and [tool]. ',
      },
      { text: 'Currently learning [service] for [goal].', cited: true },
    ],
    true,
  ),
  3: source(
    3,
    'project',
    'Projects',
    '[Project name]',
    'knowledge/projects/[project-name].md',
    '[Aug 30, 2026]',
    [
      { text: '[Project name] is [one-line description]. ' },
      {
        text: 'It runs on AWS using [service], [service], and [service]. ',
        cited: true,
      },
      { text: "Daniel's role: [role]." },
    ],
    true,
  ),
  4: source(
    4,
    'contact',
    'Contact',
    'Public contact page',
    'knowledge/contact.md',
    '[Sep 1, 2026]',
    [
      {
        text: 'The preferred way to reach Daniel is the public contact page. ',
        cited: true,
      },
      {
        text: 'Daniel does not share a phone number or street address.',
        cited: true,
      },
    ],
    true,
  ),
  5: source(
    5,
    'availability',
    'Availability',
    'Current availability',
    'knowledge/availability.md',
    '[Sep 20, 2026]',
    [
      {
        text: 'Daniel is open to internships starting [month year]. ',
        cited: true,
      },
      {
        text: 'Preferred setup: [remote / hybrid / on-site] in [city].',
        cited: true,
      },
    ],
    false,
  ),
};

export interface CannedAnswer {
  readonly text: string;
  // Display order of the source cards.
  readonly sources: readonly number[];
  // Markers the model used that retrieval could not attach.
  readonly extraCited?: readonly number[];
}

export const ANSWERS: Readonly<Record<string, CannedAnswer>> = {
  [Q_STUDYING]: {
    text: 'Daniel is studying Systems Engineering at ITESO in Jalisco, Mexico [1], with a focus on software development [2]. Daniel expects to graduate in [year] [1].',
    sources: [1, 2],
  },
  [Q_AWS]: {
    text: 'Daniel has worked with [service], [service], and [service] in [project name] [3], and is currently learning [service] for [goal] [2].',
    sources: [3, 2],
  },
  [Q_PROJECT]: {
    text: '**[Project name]** is [one-line description] [3]. From the project notes:\n- The frontend is built with [framework] and the API with [framework] [3]\n- It is deployed on AWS using `[service]` and `[service]` [3]\n- [Outcome or lesson learned] [3]',
    sources: [3],
  },
  [Q_BEST_AT]: {
    text: "According to the reviewed sources, Daniel's strongest areas are **software development** and **[second strength]** [2]. Day-to-day tools include [language], [framework], and [tool] [2][6].",
    sources: [2],
    extraCited: [6],
  },
  [Q_INTERNSHIPS]: {
    text: 'Yes. Daniel is open to internships starting [month year] [5], preferably [remote / hybrid / on-site] in [city] [5].',
    sources: [5],
  },
  [Q_CONTACT]: {
    text: 'The best way to reach Daniel is the public contact page linked in the card [4]. Daniel does not share a phone number or street address [4].',
    sources: [4],
  },
};

export const NO_COVERAGE_TEXT =
  "Daniel's public sources don't cover that yet. You could try one of these related questions:";

export function answerFor(question: string): CannedAnswer | null {
  return ANSWERS[question] ?? null;
}

export function sourcesFor(answer: CannedAnswer): SourceCitation[] {
  return answer.sources.flatMap((n) => {
    const found = SOURCES[n];
    return found ? [found] : [];
  });
}

export function citedIn(answer: CannedAnswer): number[] {
  const inText = [...answer.text.matchAll(/\[(\d+)\]/g)].map((m) =>
    Number(m[1]),
  );
  return [...new Set([...inText, ...(answer.extraCited ?? [])])];
}

// Splits text into word-sized deltas, the way a model streams tokens.
export function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}
