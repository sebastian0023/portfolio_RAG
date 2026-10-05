import { chunkDocument, type Chunk } from './chunker.js';
import { checkMetadataLimits, toVectorMetadata } from './metadata.js';
import type { Finding } from './config.js';
import { parseFrontmatter } from './frontmatter.js';
import type { Configs } from './config.js';
import { buildManifest, normalizeNewlines } from './manifest.js';
import type { BuiltManifest, ManifestEntry } from './manifest.js';
import { parseSections } from './markdown.js';
import { scanPublicSafety } from './public-safety.js';

export interface CorpusFile {
  // Repository-relative, forward slashes, for example `knowledge/education.md`.
  readonly path: string;
  readonly raw: string;
}

export interface CorpusOptions {
  readonly allowedHosts: readonly string[];
  readonly allowedEmails?: readonly string[];
  readonly now: number;
  readonly configs?: Configs;
}

export type CorpusResult =
  | {
      readonly ok: true;
      readonly built: BuiltManifest;
      readonly chunks: readonly Chunk[];
    }
  | { readonly ok: false; readonly findings: readonly Finding[] };

// The whole corpus gate in one pure function: every file must parse, pass the public-safety scan, and chunk within
// the metadata limits, and ids must be unique. Used by the CI lint over knowledge/ and by the ingest tool, so
// they cannot disagree about what is acceptable.
export function loadCorpus(
  files: readonly CorpusFile[],
  options: CorpusOptions,
): CorpusResult {
  const findings: Finding[] = [];
  const entries: ManifestEntry[] = [];
  const ids = new Map<string, string>();
  const chunkIds = new Set<string>();

  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const raw = normalizeNewlines(file.raw);
    findings.push(
      ...scanPublicSafety(raw, {
        path: file.path,
        allowedHosts: options.allowedHosts,
        ...(options.allowedEmails === undefined
          ? {}
          : { allowedEmails: options.allowedEmails }),
      }),
    );

    const front = parseFrontmatter(raw, options);
    if (!front.ok) {
      findings.push(
        ...front.rules.map((rule) => ({ path: file.path, rule, line: 1 })),
      );
      continue;
    }
    const earlier = ids.get(front.meta.id);
    if (earlier !== undefined) {
      findings.push({ path: file.path, rule: 'duplicate_id', line: 1 });
      continue;
    }
    ids.set(front.meta.id, file.path);

    const parsed = parseSections(front.body, front.bodyStartLine);
    findings.push(
      ...parsed.rules.map((r) => ({
        path: file.path,
        rule: r.rule,
        line: r.line,
      })),
    );
    if (parsed.sections.length === 0) {
      findings.push({ path: file.path, rule: 'empty_document', line: 1 });
      continue;
    }

    const chunks = chunkDocument(front.meta, parsed.sections, file.path);
    for (const chunk of chunks) {
      if (chunkIds.has(chunk.chunkId)) {
        findings.push({ path: file.path, rule: 'duplicate_chunk', line: 1 });
      }
      chunkIds.add(chunk.chunkId);
      for (const rule of checkMetadataLimits(toVectorMetadata(chunk))) {
        findings.push({ path: file.path, rule, line: 1 });
      }
    }
    entries.push({ meta: front.meta, path: file.path, raw, chunks });
  }

  if (findings.length > 0) return { ok: false, findings };
  return {
    ok: true,
    built: buildManifest(entries, options.configs),
    chunks: entries.flatMap((entry) => entry.chunks),
  };
}
