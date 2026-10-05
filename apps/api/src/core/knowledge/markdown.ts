// Turns a document body into plain-text sections. The corpus is a small, controlled subset of Markdown: H2 and H3
// headings, paragraphs, and `-` lists. Links become their text and emphasis is stripped, because the chunk text
// is shown to visitors as plain text and fed to the model as data.

export interface Section {
  readonly heading: string;
  readonly slug: string;
  readonly text: string;
}

export interface SectionsResult {
  readonly sections: readonly Section[];
  readonly rules: readonly { readonly rule: string; readonly line: number }[];
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toPlainText(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/[*_`]/g, '')
    .replace(/^[ \t]*[-*+][ \t]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSections(body: string, firstLine: number): SectionsResult {
  const rules: { rule: string; line: number }[] = [];
  const sections: Section[] = [];
  const seen = new Set<string>();
  let heading = 'Overview';
  let parts: string[] = [];

  const flush = (): void => {
    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text !== '') {
      sections.push({ heading, slug: slugify(heading), text });
    }
    parts = [];
  };

  body.split('\n').forEach((line, i) => {
    const lineNo = firstLine + i;
    const match = HEADING.exec(line);
    if (match) {
      flush();
      const level = match[1]?.length ?? 0;
      if (level === 1 || level > 3) {
        rules.push({ rule: 'heading_level', line: lineNo });
      }
      heading = toPlainText(match[2] ?? '');
      const slug = slugify(heading);
      if (slug === '' || seen.has(slug)) {
        rules.push({
          rule: slug === '' ? 'heading_empty' : 'heading_duplicate',
          line: lineNo,
        });
      }
      seen.add(slug);
      return;
    }
    const text = toPlainText(line);
    if (text !== '') parts.push(text);
  });
  flush();
  return { sections, rules };
}
