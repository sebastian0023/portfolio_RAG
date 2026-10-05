import { SOURCE_KINDS, isAllowedSourceUrl } from '@portfolio/shared';
import type { SourceKind } from '@portfolio/shared';
import { z } from 'zod';
import { SOURCE_ID_PATTERN } from './config.js';

export interface Frontmatter {
  readonly id: string;
  readonly title: string;
  readonly kind: SourceKind;
  readonly lang: 'en';
  readonly updated: string;
  readonly url?: string;
}

export type FrontmatterResult =
  | {
      readonly ok: true;
      readonly meta: Frontmatter;
      readonly body: string;
      // 1-based line of the first body line, so later findings point at the right place in the file.
      readonly bodyStartLine: number;
    }
  | { readonly ok: false; readonly rules: readonly string[] };

export interface FrontmatterOptions {
  readonly allowedHosts: readonly string[];
  readonly now: number;
}

const KEY_LINE = /^([a-z]+):[ \t]*(.*?)[ \t]*$/;

function isRealDate(value: string, now: number): boolean {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(ms) &&
    new Date(ms).toISOString().startsWith(value) &&
    ms <= now
  );
}

// A deliberately small parser: `key: value` lines between two `---` lines. No nesting, no multi-line values, no
// YAML dependency. Anything it does not understand is a finding rather than a guess.
export function parseFrontmatter(
  raw: string,
  options: FrontmatterOptions,
): FrontmatterResult {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return { ok: false, rules: ['frontmatter'] };
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end < 0) return { ok: false, rules: ['frontmatter'] };

  const values: Record<string, string> = {};
  const rules = new Set<string>();
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') continue;
    const match = KEY_LINE.exec(line);
    if (!match?.[1] || Object.hasOwn(values, match[1])) {
      rules.add('frontmatter');
      continue;
    }
    values[match[1]] = (match[2] ?? '').replace(/^(["'])(.*)\1$/, '$2');
  }
  if (rules.size > 0) return { ok: false, rules: [...rules] };

  const schema = z.strictObject({
    id: z.string().regex(SOURCE_ID_PATTERN),
    title: z.string().min(1).max(120),
    kind: z.enum(SOURCE_KINDS),
    lang: z.literal('en'),
    updated: z.string().refine((v) => isRealDate(v, options.now)),
    url: z
      .string()
      .refine((v) => isAllowedSourceUrl(v, options.allowedHosts))
      .exactOptional(),
    reviewed: z.literal('true'),
  });
  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    // Zod's messages can quote the value; report only which field failed.
    const fields = new Set(parsed.error.issues.map((i) => String(i.path[0])));
    return {
      ok: false,
      rules: [...fields].map((field) => `frontmatter.${field}`),
    };
  }
  // `reviewed` is a gate, not data: once it has passed it carries no information.
  const { id, title, kind, lang, updated, url } = parsed.data;
  return {
    ok: true,
    meta: {
      id,
      title,
      kind,
      lang,
      updated,
      ...(url === undefined ? {} : { url }),
    },
    body: lines.slice(end + 1).join('\n'),
    bodyStartLine: end + 2,
  };
}
