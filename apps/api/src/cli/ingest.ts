// Operator-run corpus ingestion (ADR-053). This file is its own composition root (ADR-043): it builds the AWS
// clients itself and is never imported by the Lambda. Dry-run is the default and builds no AWS client at all.
//
//   node apps/api/dist/cli/ingest.mjs [--dir knowledge] [--salt s] [--apply]
//
// --apply must run as the dedicated role (a budget kill-switch target); any other identity is refused before
// anything is created or spent.
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { ALLOWED_SOURCE_HOSTS } from '@portfolio/shared';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { TitanEmbedder } from '../adapters/bedrock/titan-embedder.js';
import { S3VectorsIndexAdmin } from '../adapters/s3vectors/s3-vectors-index-admin.js';
import { S3VectorsIndexRepository } from '../adapters/s3vectors/s3-vectors-index-repository.js';
import { CONFIGS } from '../core/knowledge/config.js';
import { loadCorpus } from '../core/knowledge/corpus.js';
import type { CorpusFile } from '../core/knowledge/corpus.js';
import { isAssumedRole } from '../core/knowledge/identity.js';
import {
  planIngestion,
  runIngestion,
  type IngestDeps,
} from '../core/knowledge/ingest.js';
import { readCorpusFiles } from './corpus-files.js';

export const INGEST_ROLE = 'portfolio-v2-prod-ingest';

export interface IngestCliDeps {
  readonly readCorpus: (dir: string) => CorpusFile[];
  readonly writeFile: (path: string, content: string) => void;
  readonly now: () => number;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  // Called only for --apply. Throws if the caller is not the ingest role.
  readonly connect: () => Promise<IngestDeps>;
}

export async function run(
  argv: readonly string[],
  deps: IngestCliDeps,
): Promise<number> {
  let values: { apply?: boolean; dir?: string; salt?: string; out?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        apply: { type: 'boolean' },
        dir: { type: 'string' },
        salt: { type: 'string' },
        out: { type: 'string' },
      },
      strict: true,
    }));
  } catch {
    deps.err(
      'usage: ingest [--dir knowledge] [--salt s] [--out evals/indexes] [--apply]',
    );
    return 2;
  }

  const dir = values.dir ?? 'knowledge';
  const files = deps.readCorpus(dir);
  const result = loadCorpus(files, {
    allowedHosts: ALLOWED_SOURCE_HOSTS,
    now: deps.now(),
    ...(values.salt === undefined
      ? {}
      : { configs: { ...CONFIGS, salt: values.salt } }),
  });
  if (!result.ok) {
    // Rule and line only: a finding never contains the text it matched.
    for (const f of result.findings) deps.err(`${f.path}:${f.line} ${f.rule}`);
    deps.err(`corpus rejected: ${result.findings.length} finding(s)`);
    return 1;
  }
  if (result.chunks.length === 0) {
    deps.err('no knowledge files found; nothing to index');
    return 1;
  }

  const plan = planIngestion(result.built, result.chunks);
  deps.out(
    JSON.stringify(
      {
        mode: values.apply ? 'apply' : 'dry-run',
        files: files.length,
        ...plan,
      },
      null,
      2,
    ),
  );
  if (!plan.withinCaps) {
    deps.err('over the ingestion caps; nothing was called');
    return 1;
  }
  if (values.apply !== true) {
    deps.out(
      'dry run: nothing was created. Re-run with --apply as the ingest role.',
    );
    return 0;
  }

  let ingest: IngestDeps;
  try {
    ingest = await deps.connect();
  } catch {
    deps.err(
      `could not start: run --apply as the ${INGEST_ROLE} role with valid credentials`,
    );
    return 1;
  }
  const outcome = await runIngestion(ingest, result.built, result.chunks);
  if (!outcome.ok) {
    deps.err(
      `ingestion failed: ${outcome.reason} (embedding calls: ${outcome.embedCalls})`,
    );
    return 1;
  }
  deps.writeFile(
    `${values.out ?? 'evals/indexes'}/${outcome.indexName}.json`,
    `${JSON.stringify(
      {
        indexName: outcome.indexName,
        manifestSha256: result.built.manifestSha256,
        manifest: result.built.manifest,
      },
      null,
      2,
    )}\n`,
  );
  deps.out(
    `${outcome.action}: ${outcome.indexName} (${outcome.chunks} chunks, ${outcome.embedCalls} embedding calls)`,
  );
  return 0;
}

const TAGS = {
  Application: 'portfolio-v2',
  Environment: 'prod',
  CostScope: 'portfolio-v2-prod',
  ManagedBy: 'ingest',
} as const;

async function connect(env: NodeJS.ProcessEnv): Promise<IngestDeps> {
  const region = env['AWS_REGION'] ?? 'us-east-1';
  const identity = await new STSClient({ region }).send(
    new GetCallerIdentityCommand({}),
  );
  if (!isAssumedRole(identity.Arn ?? '', INGEST_ROLE)) {
    throw new Error('wrong role');
  }
  const bucket = env['VECTOR_BUCKET'] ?? 'portfolio-v2-prod-vectors';
  const prefix = env['PARAMETER_PREFIX'] ?? '/portfolio-v2/prod';
  const vectors = new S3VectorsClient({ region, maxAttempts: 2 });
  const ssm = new SSMClient({ region });
  const admin = new S3VectorsIndexAdmin(vectors, bucket, TAGS);
  return {
    admin,
    // Embedding retries are ours (one per call, with a rate cap), so the SDK does not add more.
    embedder: new TitanEmbedder(
      new BedrockRuntimeClient({ region, maxAttempts: 1 }),
    ),
    repository: new S3VectorsIndexRepository(vectors, { bucket }),
    activeIndex: async () => {
      const out = await ssm.send(
        new GetParameterCommand({ Name: `${prefix}/active_index` }),
      );
      const value = out.Parameter?.Value;
      if (value === undefined || value === '')
        throw new Error('active_index unreadable');
      return value;
    },
  };
}

if (import.meta.main) {
  const root = resolve(process.cwd());
  process.exitCode = await run(process.argv.slice(2), {
    readCorpus: (dir) => readCorpusFiles(resolve(root, dir), root),
    writeFile: (path, content) => {
      const target = resolve(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    },
    now: Date.now,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    connect: () => connect(process.env),
  });
}
