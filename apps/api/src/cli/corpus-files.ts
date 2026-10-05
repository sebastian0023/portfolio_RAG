import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { CorpusFile } from '../core/knowledge/corpus.js';

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name))
      : entry.name.endsWith('.md') && entry.name !== 'README.md'
        ? [join(dir, entry.name)]
        : [],
  );
}

// Reads every knowledge file under `dir`, with paths relative to `root` (the repository root) and forward slashes.
export function readCorpusFiles(dir: string, root: string): CorpusFile[] {
  const base = resolve(dir);
  return walk(base).map((file) => ({
    path: relative(resolve(root), file).replaceAll('\\', '/'),
    raw: readFileSync(file, 'utf8'),
  }));
}
