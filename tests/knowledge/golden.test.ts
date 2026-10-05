import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { parseDataset } from '../../apps/api/src/core/rag/eval/dataset.ts';

// The golden questions must be well formed and point at sources that exist, or the gate would pass or fail for
// reasons that have nothing to do with retrieval quality. Source ids are read from the knowledge files.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const text = readFileSync(
  resolve(root, 'evals/retrieval/golden.jsonl'),
  'utf8',
);

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
function mdFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? mdFiles(join(dir, e.name))
      : e.name.endsWith('.md') && e.name !== 'README.md'
        ? [join(dir, e.name)]
        : [],
  );
}
const ids = new Set(
  mdFiles(resolve(root, 'knowledge')).map(
    (f) => /^id: (.+)$/m.exec(readFileSync(f, 'utf8'))?.[1] ?? '',
  ),
);

describe('evals/retrieval/golden.jsonl', () => {
  const parsed = parseDataset(text);

  test('is a valid dataset', () => {
    expect(parsed.ok, parsed.ok ? '' : parsed.problem).toBe(true);
  });

  test('has enough of each kind to mean something', () => {
    if (!parsed.ok) throw new Error('invalid dataset');
    const count = (k: string) =>
      parsed.cases.filter((c) => c.kind === k).length;
    expect(count('answerable')).toBeGreaterThanOrEqual(12);
    expect(count('off_topic')).toBeGreaterThanOrEqual(4);
    expect(count('injection')).toBeGreaterThanOrEqual(3);
  });

  test('every expected source id is a real knowledge file', () => {
    if (!parsed.ok) throw new Error('invalid dataset');
    for (const c of parsed.cases) {
      if (c.kind !== 'answerable') continue;
      for (const id of c.expectedSourceIds)
        expect(ids.has(id), `${c.id}: ${id}`).toBe(true);
    }
  });

  test('every source is covered by at least one question, so none can silently rot', () => {
    if (!parsed.ok) throw new Error('invalid dataset');
    const covered = new Set(
      parsed.cases.flatMap((c) =>
        c.kind === 'answerable' ? c.expectedSourceIds : [],
      ),
    );
    for (const id of ids) expect(covered.has(id), id).toBe(true);
  });
});
