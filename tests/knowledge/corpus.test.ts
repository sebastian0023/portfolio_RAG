import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { ALLOWED_SOURCE_HOSTS } from '@portfolio/shared';
import { loadCorpus } from '../../apps/api/src/core/knowledge/corpus.ts';

// The real corpus must pass the same gate the ingest tool applies (ADR-053). It passes with zero files, so the
// check is active from the day the first file lands.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = join(root, 'knowledge');

function walk(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(path, entry.name))
      : entry.name.endsWith('.md') && entry.name !== 'README.md'
        ? [join(path, entry.name)]
        : [],
  );
}

describe('knowledge/ corpus', () => {
  const files = existsSync(dir)
    ? walk(dir).map((file) => ({
        path: relative(root, file).replaceAll('\\', '/'),
        raw: readFileSync(file, 'utf8'),
      }))
    : [];

  test('passes the public-safety and format gate', () => {
    const result = loadCorpus(files, {
      allowedHosts: ALLOWED_SOURCE_HOSTS,
      now: Date.now(),
    });
    expect(
      result.ok ? [] : result.findings,
      'findings name a rule and a line, never the text',
    ).toEqual([]);
  });
});
