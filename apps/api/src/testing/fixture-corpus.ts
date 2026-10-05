import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CorpusFile } from '../core/knowledge/corpus.js';

export const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/knowledge/valid',
);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name))
      : entry.name.endsWith('.md')
        ? [join(dir, entry.name)]
        : [],
  );
}

// The synthetic corpus as the ingest tool would read it: repository-relative `knowledge/...` paths.
export function fixtureCorpusFiles(): CorpusFile[] {
  return walk(FIXTURE_DIR).map((file) => ({
    path: `knowledge/${relative(FIXTURE_DIR, file).replaceAll('\\', '/')}`,
    raw: readFileSync(file, 'utf8'),
  }));
}

export const FIXTURE_OPTIONS = {
  allowedHosts: ['example.org'],
  now: Date.parse('2026-10-04T00:00:00Z'),
} as const;
