import { describe, expect, test } from 'vitest';
import { FakeEmbedder } from '../testing/fake-embedder.js';
import { FakeIndexAdmin } from '../testing/fake-index-admin.js';
import type { CorpusFile } from '../core/knowledge/corpus.js';
import type { IngestDeps } from '../core/knowledge/ingest.js';
import { run, type IngestCliDeps } from './ingest.js';

// The fixtures link to example.org, which is not on the production allowlist (empty until the owner approves
// hosts with the corpus), so the CLI sees them without their `url:` line and without any link.
const doc = (id: string, kind: string, body: string): CorpusFile => ({
  path: `knowledge/${id}.md`,
  raw: `---\nid: ${id}\ntitle: Title of ${id}\nkind: ${kind}\nlang: en\nupdated: 2026-03-01\nreviewed: true\n---\n${body}\n`,
});
const FILES = [
  doc(
    'exp-one',
    'experience',
    '## Work\nAlex built tools for robots. The team was small.',
  ),
  doc('faq-one', 'faq', '## Roles\nAlex wants backend roles on small teams.'),
];

function harness(overrides: Partial<IngestCliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, string>();
  const admin = new FakeIndexAdmin();
  const calls = { connect: 0 };
  const ingest: IngestDeps = {
    admin,
    embedder: new FakeEmbedder(),
    repository: admin,
    activeIndex: () => Promise.resolve('chunks-aaaaaaaaaaaaaaaa'),
    sleep: () => Promise.resolve(),
    random: () => 0,
  };
  const deps: IngestCliDeps = {
    readCorpus: () => FILES,
    writeFile: (path, content) => void written.set(path, content),
    now: () => Date.parse('2026-10-04T00:00:00Z'),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    connect: () => {
      calls.connect++;
      return Promise.resolve(ingest);
    },
    ...overrides,
  };
  return { deps, out, err, written, admin, calls };
}

const summary = (out: string[]) =>
  JSON.parse(out[0] ?? '{}') as {
    mode: string;
    indexName: string;
    chunks: number;
    withinCaps: boolean;
  };

describe('ingest CLI', () => {
  test('is a dry run by default: it reports the plan and connects to nothing', async () => {
    const h = harness();
    expect(await run([], h.deps)).toBe(0);
    expect(h.calls.connect).toBe(0);
    expect(h.admin.indexes.size).toBe(0);
    expect(h.written.size).toBe(0);
    const s = summary(h.out);
    expect(s).toMatchObject({ mode: 'dry-run', withinCaps: true });
    expect(s.indexName).toMatch(/^chunks-[0-9a-f]{16}$/);
    expect(h.out.join('\n')).toContain('nothing was created');
  });

  test('--apply builds the index and records the public manifest', async () => {
    const h = harness();
    expect(await run(['--apply'], h.deps)).toBe(0);
    const { indexName } = summary(h.out);
    expect(h.admin.indexes.get(indexName)?.complete).toBe(true);
    const manifest = h.written.get(`evals/indexes/${indexName}.json`);
    expect(manifest).toBeDefined();
    const parsed = JSON.parse(manifest ?? '{}') as {
      indexName: string;
      manifestSha256: string;
    };
    expect(parsed.indexName).toBe(indexName);
    expect(
      parsed.manifestSha256.startsWith(indexName.slice('chunks-'.length)),
    ).toBe(true);
    // Public-only: no chunk text in the manifest.
    expect(manifest).not.toContain('Alex built tools');
  });

  test('a second --apply is a no-op that makes no embedding calls', async () => {
    const h = harness();
    await run(['--apply'], h.deps);
    const puts = h.admin.calls.put;
    h.out.length = 0;
    expect(await run(['--apply'], h.deps)).toBe(0);
    expect(h.admin.calls.put).toBe(puts);
    expect(h.out.at(-1)).toMatch(
      /^noop: chunks-[0-9a-f]{16} \(\d+ chunks, 0 embedding calls\)$/,
    );
  });

  test('refuses before spending when it cannot start as the ingest role', async () => {
    const h = harness({
      connect: () => Promise.reject(new Error('wrong role RAW')),
    });
    expect(await run(['--apply'], h.deps)).toBe(1);
    expect(h.written.size).toBe(0);
    expect(h.err.join('\n')).toContain('portfolio-v2-prod-ingest');
    expect(h.err.join('\n')).not.toContain('RAW');
  });

  test('--salt produces a different index (the rollback drill)', async () => {
    const plain = harness();
    await run([], plain.deps);
    const salted = harness();
    await run(['--salt', 'drill'], salted.deps);
    expect(summary(salted.out).indexName).not.toBe(
      summary(plain.out).indexName,
    );
  });

  test('rejects an unsafe corpus with rule and line only, and never connects', async () => {
    const secret = `ghp_${'q'.repeat(30)}`;
    const h = harness({
      readCorpus: () => [
        doc('bad-one', 'faq', `## Notes\nToken ${secret} here.`),
      ],
    });
    expect(await run(['--apply'], h.deps)).toBe(1);
    expect(h.calls.connect).toBe(0);
    expect(h.err.join('\n')).toContain('knowledge/bad-one.md:');
    expect(h.err.join('\n')).toContain('secret');
    expect(h.err.join('\n')).not.toContain(secret);
  });

  test('an empty corpus is an error, not an empty index', async () => {
    const h = harness({ readCorpus: () => [] });
    expect(await run(['--apply'], h.deps)).toBe(1);
    expect(h.calls.connect).toBe(0);
  });

  test('an unknown flag is a usage error', async () => {
    const h = harness();
    expect(await run(['--force'], h.deps)).toBe(2);
    expect(h.calls.connect).toBe(0);
  });

  test('reports a failed ingestion without detail and writes no manifest', async () => {
    const h = harness();
    h.admin.failPutNumber = 1;
    expect(await run(['--apply'], h.deps)).toBe(1);
    expect(h.written.size).toBe(0);
    expect(h.err.join('\n')).toContain('admin_failed');
    expect(h.err.join('\n')).not.toContain('RAW-ADMIN-DETAIL');
  });
});
