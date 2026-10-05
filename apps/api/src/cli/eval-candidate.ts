// Operator-run candidate quality gate (ADR-034, ADR-053). Its own composition root (ADR-043). It runs the real
// answer path (Titan, S3 Vectors, and the configured model) against a candidate index, writes a report, and
// exits non-zero unless every threshold passes. `promote` refuses a candidate without a passing, recent report.
//
//   node apps/api/dist/cli/eval-candidate.mjs --index chunks-<hash> [--dataset evals/retrieval/golden.jsonl]
//   node apps/api/dist/cli/eval-candidate.mjs --index chunks-<hash> --smoke     # 3 cases, no report
//
// It must run as the portfolio-v2-prod-eval role (a budget kill-switch target), not the operator role.
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { S3VectorsClient } from '@aws-sdk/client-s3vectors';
import { SSMClient } from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import type { LLMProvider } from '@portfolio/shared';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createBedrockConverseProvider } from '../adapters/bedrock/bedrock-converse-provider.js';
import { TitanEmbedder } from '../adapters/bedrock/titan-embedder.js';
import { S3VectorsIndexRepository } from '../adapters/s3vectors/s3-vectors-index-repository.js';
import { SsmConfigSource } from '../adapters/ssm/ssm-config-source.js';
import type { ChatService } from '../core/chat/chat-handler.js';
import {
  parseRuntimeConfig,
  type RuntimeConfig,
} from '../core/config/runtime-config.js';
import { INDEX_NAME_PATTERN } from '../core/knowledge/config.js';
import { isAssumedRole } from '../core/knowledge/identity.js';
import { canonicalJson } from '../core/knowledge/manifest.js';
import { parseDataset } from '../core/rag/eval/dataset.js';
import { runEval } from '../core/rag/eval/run-eval.js';
import { createRagService } from '../core/rag/rag-service.js';

export const EVAL_ROLE = 'portfolio-v2-prod-eval';

export interface EvalCliDeps {
  readonly readFile: (path: string) => string | undefined;
  readonly writeFile: (path: string, content: string) => void;
  readonly now: () => Date;
  readonly gitSha: () => string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  // Throws if the caller is not the eval role or the live configuration cannot be read.
  readonly connect: () => Promise<{
    readonly service: ChatService;
    readonly provider: LLMProvider;
    readonly config: RuntimeConfig;
  }>;
}

const stamp = (d: Date): string =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

export async function run(
  argv: readonly string[],
  deps: EvalCliDeps,
): Promise<number> {
  let values: {
    index?: string;
    dataset?: string;
    out?: string;
    manifests?: string;
    smoke?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        index: { type: 'string' },
        dataset: { type: 'string' },
        out: { type: 'string' },
        manifests: { type: 'string' },
        smoke: { type: 'boolean' },
      },
      strict: true,
    }));
  } catch {
    deps.err(
      'usage: eval-candidate --index chunks-<hash> [--dataset file] [--smoke]',
    );
    return 2;
  }
  const index = values.index ?? '';
  if (!INDEX_NAME_PATTERN.test(index)) {
    deps.err('--index must be chunks- followed by 16 hex characters');
    return 2;
  }

  const datasetPath = values.dataset ?? 'evals/retrieval/golden.jsonl';
  const text = deps.readFile(datasetPath);
  if (text === undefined) {
    deps.err(`dataset not found: ${datasetPath}`);
    return 1;
  }
  const dataset = parseDataset(text);
  if (!dataset.ok) {
    deps.err(`dataset rejected: ${dataset.problem}`);
    return 1;
  }
  // A smoke run is three cases against whatever index is named, to see that the path works. It writes no report
  // and cannot promote anything.
  const cases = values.smoke
    ? [
        ...dataset.cases.filter((c) => c.kind === 'answerable').slice(0, 2),
        ...dataset.cases.filter((c) => c.kind === 'off_topic').slice(0, 1),
      ]
    : dataset.cases;

  let manifestSha256 = '';
  if (values.smoke !== true) {
    const path = `${values.manifests ?? 'evals/indexes'}/${index}.json`;
    const manifest = deps.readFile(path);
    if (manifest === undefined) {
      deps.err(
        `no manifest for ${index}: ingest it first so the report can be bound to its build`,
      );
      return 1;
    }
    try {
      manifestSha256 = String(
        (JSON.parse(manifest) as { manifestSha256?: unknown }).manifestSha256 ??
          '',
      );
    } catch {
      manifestSha256 = '';
    }
    if (
      !/^[0-9a-f]{64}$/.test(manifestSha256) ||
      !manifestSha256.startsWith(index.slice('chunks-'.length))
    ) {
      deps.err(`manifest for ${index} is not valid`);
      return 1;
    }
  }

  let connected: Awaited<ReturnType<EvalCliDeps['connect']>>;
  try {
    connected = await deps.connect();
  } catch {
    deps.err(
      `could not start: run as the ${EVAL_ROLE} role with valid credentials`,
    );
    return 1;
  }
  const config: RuntimeConfig = { ...connected.config, activeIndex: index };
  const report = await runEval({
    service: connected.service,
    provider: connected.provider,
    config,
    cases,
    meta: {
      manifestSha256,
      gitSha: deps.gitSha(),
      llmConfig: canonicalJson(config.llm),
      now: deps.now,
    },
  });

  deps.out(
    JSON.stringify(
      {
        index,
        cases: cases.length,
        metrics: report.metrics,
        passed: report.passed,
        failures: report.failures,
      },
      null,
      2,
    ),
  );
  for (const c of report.cases.filter((r) => !r.ok))
    deps.err(`case ${c.id} (${c.kind}) failed: ${c.failure ?? 'unknown'}`);
  if (values.smoke === true) {
    deps.out('smoke run: no report written, and it cannot be used to promote.');
    return report.passed ? 0 : 1;
  }
  deps.writeFile(
    `${values.out ?? 'evals/reports'}/${index}-${stamp(deps.now())}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report.passed ? 0 : 1;
}

async function connect(
  env: NodeJS.ProcessEnv,
): ReturnType<EvalCliDeps['connect']> {
  const region = env['AWS_REGION'] ?? 'us-east-1';
  const identity = await new STSClient({ region }).send(
    new GetCallerIdentityCommand({}),
  );
  if (!isAssumedRole(identity.Arn ?? '', EVAL_ROLE))
    throw new Error('wrong role');

  const prefix = env['PARAMETER_PREFIX'] ?? '/portfolio-v2/prod';
  const bucket = env['VECTOR_BUCKET'] ?? 'portfolio-v2-prod-vectors';
  const raw = await new SsmConfigSource(
    new SSMClient({ region }),
    prefix,
  ).load();
  const parsed = parseRuntimeConfig(raw);
  if (!parsed.ok) throw new Error('configuration is not valid');
  if (parsed.config.llm.provider !== 'bedrock-runtime') {
    throw new Error('the configured model has no adapter yet');
  }
  const bedrock = new BedrockRuntimeClient({ region, maxAttempts: 1 });
  const service = createRagService({
    embedder: new TitanEmbedder(
      new BedrockRuntimeClient({ region, maxAttempts: 2 }),
    ),
    repository: new S3VectorsIndexRepository(
      new S3VectorsClient({ region, maxAttempts: 2 }),
      { bucket },
    ),
    // The gate reports metrics itself; per-request logs would only add noise.
    logger: { log: () => undefined },
  });
  return {
    service,
    provider: createBedrockConverseProvider(bedrock, parsed.config.llm.model),
    config: parsed.config,
  };
}

if (import.meta.main) {
  const root = resolve(process.cwd());
  process.exitCode = await run(process.argv.slice(2), {
    readFile: (path) => {
      try {
        return readFileSync(resolve(root, path), 'utf8');
      } catch {
        return undefined;
      }
    },
    writeFile: (path, content) => {
      const target = resolve(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    },
    now: () => new Date(),
    gitSha: () => {
      try {
        return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim();
      } catch {
        return 'unknown';
      }
    },
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    connect: () => connect(process.env),
  });
}
