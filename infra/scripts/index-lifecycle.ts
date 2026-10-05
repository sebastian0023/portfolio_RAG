// Promotes, rolls back, and prunes retrieval indexes (operator-run; ADR-019, ADR-053, R-16).
//
//   node infra/scripts/index-lifecycle.ts status
//   node infra/scripts/index-lifecycle.ts promote --candidate chunks-<hash> --report evals/reports/<file>.json [--apply]
//   node infra/scripts/index-lifecycle.ts rollback [--to chunks-<hash>|none] [--apply]
//   node infra/scripts/index-lifecycle.ts prune [--apply]
//
// Run it as the operator role with the MFA session exported (docs/operations/apply-procedure.md). Every command
// that changes something is a dry run unless --apply is given. It only ever names the portfolio-v2 parameter and
// vector bucket below; there are no flags to point it elsewhere (ADR-047).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  INDEX_NAME,
  NONE,
  canonicalJson,
  checkCandidate,
  defaultRollbackTarget,
  parseHistory,
  planPrune,
  retention,
  toMillis,
  verifyReport,
  wroteExpectedVersion,
  type CandidateState,
  type IndexSummary,
} from './index-lifecycle-lib.ts';

export const ACTIVE_PARAMETER = '/portfolio-v2/prod/active_index';
export const LLM_PARAMETER = '/portfolio-v2/prod/llm_config';
export const VECTOR_BUCKET = 'portfolio-v2-prod-vectors';

export interface LifecycleIo {
  // Runs the AWS CLI and returns stdout; throws if it exits non-zero.
  readonly aws: (args: readonly string[]) => string;
  readonly readFile: (path: string) => string | undefined;
  readonly now: () => number;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const json = (text: string): Record<string, unknown> =>
  JSON.parse(text) as Record<string, unknown>;

function readParameter(
  io: LifecycleIo,
  name: string,
): { value: string; version: number } {
  const out = json(
    io.aws(['ssm', 'get-parameter', '--name', name, '--output', 'json']),
  );
  const parameter = out['Parameter'] as
    { Value?: unknown; Version?: unknown } | undefined;
  if (
    typeof parameter?.Value !== 'string' ||
    !Number.isInteger(parameter.Version)
  ) {
    throw new Error(`could not read ${name}`);
  }
  return { value: parameter.Value, version: parameter.Version as number };
}

const readHistory = (io: LifecycleIo) =>
  parseHistory(
    io.aws([
      'ssm',
      'get-parameter-history',
      '--name',
      ACTIVE_PARAMETER,
      '--output',
      'json',
    ]),
  );

function listIndexes(io: LifecycleIo): (IndexSummary & { arn: string })[] {
  const found: (IndexSummary & { arn: string })[] = [];
  let token: string | undefined;
  do {
    const out = json(
      io.aws([
        's3vectors',
        'list-indexes',
        '--vector-bucket-name',
        VECTOR_BUCKET,
        '--output',
        'json',
        ...(token === undefined ? [] : ['--next-token', token]),
      ]),
    );
    for (const item of (out['indexes'] as
      Record<string, unknown>[] | undefined) ?? []) {
      if (
        typeof item['indexName'] !== 'string' ||
        typeof item['indexArn'] !== 'string'
      ) {
        throw new Error('malformed index listing');
      }
      found.push({
        name: item['indexName'],
        arn: item['indexArn'],
        createdAt: toMillis(item['creationTime']),
      });
    }
    token = typeof out['nextToken'] === 'string' ? out['nextToken'] : undefined;
  } while (token !== undefined);
  return found;
}

function tagsOf(io: LifecycleIo, arn: string): Record<string, string> {
  const out = json(
    io.aws([
      's3vectors',
      'list-tags-for-resource',
      '--resource-arn',
      arn,
      '--output',
      'json',
    ]),
  );
  return (out['tags'] as Record<string, string> | undefined) ?? {};
}

function countKeys(io: LifecycleIo, index: string): number {
  let count = 0;
  let token: string | undefined;
  do {
    const out = json(
      io.aws([
        's3vectors',
        'list-vectors',
        '--vector-bucket-name',
        VECTOR_BUCKET,
        '--index-name',
        index,
        '--max-results',
        '500',
        '--output',
        'json',
        ...(token === undefined ? [] : ['--next-token', token]),
      ]),
    );
    count += ((out['vectors'] as unknown[] | undefined) ?? []).length;
    token = typeof out['nextToken'] === 'string' ? out['nextToken'] : undefined;
  } while (token !== undefined);
  return count;
}

function candidateState(io: LifecycleIo, name: string): CandidateState {
  const index = listIndexes(io).find((i) => i.name === name);
  if (index === undefined)
    return {
      exists: false,
      complete: false,
      manifestSha256: undefined,
      keyCount: 0,
    };
  const tags = tagsOf(io, index.arn);
  return {
    exists: true,
    complete: tags['IngestStatus'] === 'complete',
    manifestSha256: tags['ManifestSha256'],
    keyCount: countKeys(io, name),
  };
}

function manifestOf(
  io: LifecycleIo,
  candidate: string,
): { manifestSha256: string; keyCount: number } | undefined {
  const text = io.readFile(`evals/indexes/${candidate}.json`);
  if (text === undefined) return undefined;
  try {
    const parsed = JSON.parse(text) as {
      manifestSha256?: unknown;
      manifest?: { sources?: { chunks?: unknown[] }[] };
    };
    if (typeof parsed.manifestSha256 !== 'string') return undefined;
    const keyCount = (parsed.manifest?.sources ?? []).reduce(
      (sum, s) => sum + (s.chunks?.length ?? 0),
      0,
    );
    return { manifestSha256: parsed.manifestSha256, keyCount };
  } catch {
    return undefined;
  }
}

// Writes the parameter only if nobody else changed it since `readVersion`, as far as SSM lets us tell.
function writeActive(
  io: LifecycleIo,
  value: string,
  readVersion: number,
): boolean {
  const current = readParameter(io, ACTIVE_PARAMETER);
  if (current.version !== readVersion) {
    io.err(
      'active_index changed while this command was running; nothing was written',
    );
    return false;
  }
  const out = json(
    io.aws([
      'ssm',
      'put-parameter',
      '--name',
      ACTIVE_PARAMETER,
      '--type',
      'String',
      '--value',
      value,
      '--overwrite',
      '--output',
      'json',
    ]),
  );
  const returned = Number(out['Version']);
  if (!wroteExpectedVersion(readVersion, returned)) {
    io.err(
      `unexpected parameter version ${returned} after writing (read ${readVersion}); another writer may have interleaved. Run "status" before doing anything else.`,
    );
    return false;
  }
  return true;
}

const WAIT_NOTE =
  'Wait at least 35 seconds for running functions to drop the old value (config cache 30 s), then run the smoke checks.';

export function run(argv: readonly string[], io: LifecycleIo): number {
  const [command, ...rest] = argv;
  let values: {
    candidate?: string;
    report?: string;
    to?: string;
    apply?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: [...rest],
      options: {
        candidate: { type: 'string' },
        report: { type: 'string' },
        to: { type: 'string' },
        apply: { type: 'boolean' },
      },
      strict: true,
    }));
  } catch {
    io.err(
      'usage: index-lifecycle status | promote --candidate X --report F | rollback [--to X|none] | prune [--apply]',
    );
    return 2;
  }
  const apply = values.apply === true;

  try {
    switch (command) {
      case 'status': {
        const history = readHistory(io);
        const r = retention(history, io.now());
        const indexes = listIndexes(io).map((i) => ({
          name: i.name,
          createdAt: new Date(i.createdAt).toISOString(),
          complete: tagsOf(io, i.arn)['IngestStatus'] === 'complete',
        }));
        io.out(
          JSON.stringify(
            {
              active: r.active,
              previous: r.previous,
              indexes,
              history: history.slice(-5),
            },
            null,
            2,
          ),
        );
        return 0;
      }

      case 'promote': {
        const candidate = values.candidate ?? '';
        if (!INDEX_NAME.test(candidate) || values.report === undefined) {
          io.err(
            'promote needs --candidate chunks-<16 hex> and --report <file>',
          );
          return 2;
        }
        const current = readParameter(io, ACTIVE_PARAMETER);
        readHistory(io);
        const manifest = manifestOf(io, candidate);
        if (manifest === undefined) {
          io.err(`no readable manifest at evals/indexes/${candidate}.json`);
          return 1;
        }
        const problems = checkCandidate(
          candidate,
          candidateState(io, candidate),
          manifest,
          current.value,
        );

        const reportText = io.readFile(values.report);
        let report: unknown;
        try {
          report =
            reportText === undefined ? undefined : JSON.parse(reportText);
        } catch {
          report = undefined;
        }
        const llm = canonicalJson(
          JSON.parse(readParameter(io, LLM_PARAMETER).value),
        );
        problems.push(
          ...verifyReport(report, {
            candidate,
            manifestSha256: manifest.manifestSha256,
            llmConfig: llm,
            now: io.now(),
          }),
        );
        if (problems.length > 0) {
          for (const p of problems) io.err(`refused: ${p}`);
          return 1;
        }
        io.out(
          `promote ${candidate}: currently ${current.value} (version ${current.version}); report passed and is current.`,
        );
        if (!apply) {
          io.out(
            'dry run: nothing was changed. Re-run with --apply to switch retrieval to this index.',
          );
          return 0;
        }
        if (!writeActive(io, candidate, current.version)) return 1;
        io.out(
          `promoted: active_index is now ${candidate}; the previous value ${current.value} is kept for rollback.`,
        );
        io.out(WAIT_NOTE);
        return 0;
      }

      case 'rollback': {
        const current = readParameter(io, ACTIVE_PARAMETER);
        const history = readHistory(io);
        const target = values.to ?? defaultRollbackTarget(history, io.now());
        if (target === undefined) {
          io.err(
            'no previous index to roll back to; pass --to none to switch retrieval off',
          );
          return 1;
        }
        if (target !== NONE && !INDEX_NAME.test(target)) {
          io.err('--to must be chunks-<16 hex> or none');
          return 2;
        }
        if (target === current.value) {
          io.err('that is already the active value');
          return 1;
        }
        if (target !== NONE) {
          const state = candidateState(io, target);
          if (!state.exists || !state.complete) {
            io.err(
              'refused: the rollback target does not exist or is not complete',
            );
            return 1;
          }
        }
        io.out(
          `rollback: ${current.value} -> ${target} (version ${current.version}).`,
        );
        if (!apply) {
          io.out('dry run: nothing was changed. Re-run with --apply.');
          return 0;
        }
        if (!writeActive(io, target, current.version)) return 1;
        io.out(`rolled back: active_index is now ${target}.`);
        io.out(WAIT_NOTE);
        return 0;
      }

      case 'prune': {
        const plan = planPrune(listIndexes(io), readHistory(io), io.now());
        io.out(JSON.stringify(plan, null, 2));
        if (plan.delete.length === 0) {
          io.out('nothing to delete.');
          return 0;
        }
        if (!apply) {
          io.out(
            `dry run: ${plan.delete.length} index(es) would be deleted. Re-run with --apply.`,
          );
          return 0;
        }
        for (const name of plan.delete) {
          // Re-plan right before each delete: if the parameter moved while this ran, it may now be protected.
          const again = planPrune(listIndexes(io), readHistory(io), io.now());
          if (!again.delete.includes(name)) {
            io.err(`skipped ${name}: no longer safe to delete`);
            continue;
          }
          io.aws([
            's3vectors',
            'delete-index',
            '--vector-bucket-name',
            VECTOR_BUCKET,
            '--index-name',
            name,
          ]);
          io.out(`deleted ${name}`);
        }
        return 0;
      }

      default:
        io.err('usage: index-lifecycle status | promote | rollback | prune');
        return 2;
    }
  } catch (error) {
    // The message is ours (never an AWS body), so it is safe to print.
    io.err(
      `index-lifecycle: ${error instanceof Error ? error.message : 'failed'}`,
    );
    return 1;
  }
}

if (import.meta.main) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  process.exitCode = run(process.argv.slice(2), {
    aws: (args) =>
      execFileSync(
        'aws',
        [...args, '--region', process.env['AWS_REGION'] ?? 'us-east-1'],
        {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ),
    readFile: (path) => {
      try {
        return readFileSync(resolve(root, path), 'utf8');
      } catch {
        return undefined;
      }
    },
    now: Date.now,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
}
