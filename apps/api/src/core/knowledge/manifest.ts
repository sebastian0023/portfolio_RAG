import type { Chunk } from './chunker.js';
import { sha256 } from './chunker.js';
import { CONFIGS, type Configs } from './config.js';
import type { Frontmatter } from './frontmatter.js';

// The manifest names exactly what an index contains and how it was built, without any chunk text, so it can be
// committed and reviewed publicly (ADR-053). Its hash names the index.

export interface ManifestSource {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly kind: string;
  readonly updated: string;
  readonly url?: string;
  readonly fileSha256: string;
  readonly chunks: readonly {
    readonly id: string;
    readonly contentHash: string;
  }[];
}

export interface Manifest {
  readonly manifestVersion: 1;
  readonly configs: Configs;
  readonly sources: readonly ManifestSource[];
}

export interface BuiltManifest {
  readonly manifest: Manifest;
  readonly manifestSha256: string;
  readonly indexName: string;
}

export interface ManifestEntry {
  readonly meta: Frontmatter;
  readonly path: string;
  readonly raw: string;
  readonly chunks: readonly Chunk[];
}

export const normalizeNewlines = (text: string): string =>
  text.replace(/\r\n?/g, '\n');

// JSON with sorted keys and no whitespace, so the same value always serializes to the same bytes.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildManifest(
  entries: readonly ManifestEntry[],
  configs: Configs = CONFIGS,
): BuiltManifest {
  const sources = entries
    .map((entry): ManifestSource => ({
      id: entry.meta.id,
      path: entry.path,
      title: entry.meta.title,
      kind: entry.meta.kind,
      updated: entry.meta.updated,
      ...(entry.meta.url === undefined ? {} : { url: entry.meta.url }),
      fileSha256: sha256(normalizeNewlines(entry.raw)),
      chunks: entry.chunks.map((c) => ({
        id: c.chunkId,
        contentHash: c.contentHash,
      })),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const manifest: Manifest = { manifestVersion: 1, configs, sources };
  const manifestSha256 = sha256(canonicalJson(manifest));
  return {
    manifest,
    manifestSha256,
    indexName: `chunks-${manifestSha256.slice(0, 16)}`,
  };
}
