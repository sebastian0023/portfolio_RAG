import { createHash } from 'node:crypto';
import type { SourceKind } from '@portfolio/shared';
import { CHUNKER_CONFIG } from './config.js';
import type { Frontmatter } from './frontmatter.js';
import type { Section } from './markdown.js';

export interface Chunk {
  // `<source id>#<section slug>-<k>`: stable while the section keeps its heading and earlier chunks keep their text.
  readonly chunkId: string;
  readonly sourceId: string;
  readonly kind: SourceKind;
  readonly lang: 'en';
  readonly updated: string;
  readonly title: string;
  readonly section: string;
  readonly path: string;
  readonly url?: string;
  readonly text: string;
  readonly contentHash: string;
}

export interface ChunkerLimits {
  readonly maxChars: number;
  readonly minChars: number;
}

export const sha256 = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s !== '');
}

// A sentence longer than the limit is cut at a word boundary so no chunk can exceed it.
function hardSplit(sentence: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const cut = rest.lastIndexOf(' ', max);
    const at = cut > 0 ? cut : max;
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest !== '') pieces.push(rest);
  return pieces;
}

export function packText(text: string, limits: ChunkerLimits): string[] {
  const units = splitSentences(text).flatMap((s) =>
    s.length > limits.maxChars ? hardSplit(s, limits.maxChars) : [s],
  );
  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    const joined = current === '' ? unit : `${current} ${unit}`;
    if (joined.length <= limits.maxChars) {
      current = joined;
    } else {
      chunks.push(current);
      current = unit;
    }
  }
  if (current !== '') chunks.push(current);

  // A short tail joins the previous chunk when it fits, so a section does not end in a fragment.
  const last = chunks.at(-1);
  const before = chunks.at(-2);
  if (
    chunks.length > 1 &&
    last !== undefined &&
    before !== undefined &&
    last.length < limits.minChars &&
    before.length + 1 + last.length <= limits.maxChars
  ) {
    chunks.splice(-2, 2, `${before} ${last}`);
  }
  return chunks;
}

export function chunkDocument(
  meta: Frontmatter,
  sections: readonly Section[],
  path: string,
  limits: ChunkerLimits = CHUNKER_CONFIG,
): Chunk[] {
  return sections.flatMap((section) =>
    packText(section.text, limits).map((text, index) => ({
      chunkId: `${meta.id}#${section.slug}-${index + 1}`,
      sourceId: meta.id,
      kind: meta.kind,
      lang: meta.lang,
      updated: meta.updated,
      title: meta.title,
      section: section.heading,
      path,
      ...(meta.url === undefined ? {} : { url: meta.url }),
      text,
      contentHash: sha256(text),
    })),
  );
}
