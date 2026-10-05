import type { LLMEvent } from '@portfolio/shared';
import { parseRuntimeConfig } from '../core/config/runtime-config.js';
import { loadCorpus } from '../core/knowledge/corpus.js';
import { runIngestion } from '../core/knowledge/ingest.js';
import { createRagService } from '../core/rag/rag-service.js';
import { FakeEmbedder } from './fake-embedder.js';
import { FakeIndexAdmin } from './fake-index-admin.js';
import { scriptedProvider } from './fake-llm-provider.js';
import { FIXTURE_OPTIONS, fixtureCorpusFiles } from './fixture-corpus.js';
import { memoryLogger, rawConfig } from './helpers.js';

// The synthetic corpus, ingested through the real ingestion path into the in-memory index, with a RagService on
// top and a scripted model. Everything the eval gate and its CLI need, with no network and no cost.
export async function buildFixtureStack(events: readonly LLMEvent[]) {
  const loaded = loadCorpus(fixtureCorpusFiles(), FIXTURE_OPTIONS);
  if (!loaded.ok) throw new Error('fixture corpus must load');
  const { built, chunks } = loaded;
  const admin = new FakeIndexAdmin();
  const embedder = new FakeEmbedder();
  const ingested = await runIngestion(
    {
      admin,
      embedder,
      repository: admin,
      activeIndex: () => Promise.resolve('chunks-aaaaaaaaaaaaaaaa'),
      sleep: () => Promise.resolve(),
      random: () => 0,
    },
    built,
    chunks,
  );
  if (!ingested.ok) throw new Error('fixture ingestion must succeed');
  const parsed = parseRuntimeConfig(
    rawConfig({ active_index: built.indexName }),
  );
  if (!parsed.ok) throw new Error('config must parse');
  const provider = scriptedProvider(events);
  const service = createRagService({
    embedder,
    repository: admin,
    logger: memoryLogger(),
  });
  return { built, chunks, provider, service, config: parsed.config };
}
