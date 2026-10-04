// Turns model text into typed segments. Templates render segments as text nodes, so nothing the
// model writes can become markup (R-17). Supported syntax: **bold**, `code`, "- " list lines, and
// [n] citation markers that match a source which already arrived.

export type Segment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'cite'; readonly n: number };

export interface Block {
  readonly type: 'p' | 'li';
  readonly segments: readonly Segment[];
}

export interface ParseOptions {
  // Marker numbers that have a source card; any other [n] stays literal text.
  readonly citeable: ReadonlySet<number>;
  // Markers the server said it used but could not attach; dropped instead of shown as "[6]".
  readonly unavailable?: ReadonlySet<number>;
  // While tokens arrive, hold back an unfinished marker so it does not flicker as raw syntax.
  readonly streaming?: boolean;
}

const TOKEN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[\d+\])/g;
const OPENER_TAIL = /(\*\*|\*|`|\[\d*$)/;

function pushText(segments: Segment[], text: string): void {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last?.kind === 'text') {
    segments[segments.length - 1] = { kind: 'text', text: last.text + text };
  } else {
    segments.push({ kind: 'text', text });
  }
}

function parseLine(
  line: string,
  options: ParseOptions,
  isLast: boolean,
): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const match of line.matchAll(TOKEN)) {
    const token = match[0];
    pushText(segments, line.slice(cursor, match.index));
    cursor = match.index + token.length;
    if (token.startsWith('**'))
      segments.push({ kind: 'bold', text: token.slice(2, -2) });
    else if (token.startsWith('`'))
      segments.push({ kind: 'code', text: token.slice(1, -1) });
    else {
      const n = Number(token.slice(1, -1));
      if (options.citeable.has(n)) segments.push({ kind: 'cite', n });
      else if (!options.unavailable?.has(n)) pushText(segments, token);
    }
  }
  let rest = line.slice(cursor);
  if (options.streaming && isLast) {
    const open = rest.search(OPENER_TAIL);
    if (open >= 0) rest = rest.slice(0, open);
  }
  pushText(segments, rest);
  return segments;
}

export function parseAnswer(text: string, options: ParseOptions): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  lines.forEach((raw, index) => {
    const isList = raw.startsWith('- ');
    const line = isList ? raw.slice(2) : raw;
    const segments = parseLine(line, options, index === lines.length - 1);
    if (segments.length) blocks.push({ type: isList ? 'li' : 'p', segments });
  });
  return blocks;
}

// Plain-text rendition for screen-reader announcements, copy, and history.
export function plainAnswer(blocks: readonly Block[]): string {
  return blocks
    .map((block) => {
      const body = block.segments
        .map((s) =>
          s.kind === 'cite' ? `[${s.n}]` : s.kind === 'text' ? s.text : s.text,
        )
        .join('');
      return block.type === 'li' ? `• ${body}` : body;
    })
    .join('\n');
}
