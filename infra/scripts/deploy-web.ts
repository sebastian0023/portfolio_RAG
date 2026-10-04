// Publishes the built SPA to the private web bucket and invalidates the entry point (operator-run).
// Usage: node infra/scripts/deploy-web.ts [--dry-run]
// Run it after the Terraform apply, from the same clean, pushed commit, with the MFA session exported
// (docs/operations/apply-procedure.md). It touches nothing outside the portfolio-v2 prefix.
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertDistributionId,
  assertOwnedBucket,
  cacheControlFor,
  findConflictCopies,
  hasInlineScript,
  hasTurnstileSiteKey,
  isDeployableBranchList,
  uploadOrder,
} from './deploy-web-lib.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(repoRoot, 'apps/web/dist/web/browser');
const dryRun = process.argv.includes('--dry-run');

const run = (command: string, args: string[], cwd = repoRoot): string =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name))
      : [relative(dist, join(dir, entry.name)).split('\\').join('/')],
  );
}

function fail(message: string): never {
  process.stderr.write(`deploy-web: ${message}\n`);
  process.exit(1);
}

// 1. Deploy only reviewed, pushed code from a clean tree, so the SHA recorded below describes what shipped.
if (run('git', ['status', '--porcelain']) !== '')
  fail('the working tree is not clean');
const sha = run('git', ['rev-parse', '--short', 'HEAD']);
const remotes = run('git', ['branch', '-r', '--contains', 'HEAD']).split('\n');
if (!isDeployableBranchList(remotes)) {
  fail(
    'HEAD is not on origin/dev or an origin/phase/* branch; push and merge it first',
  );
}

// 2. Targets come from Terraform, never from arguments, and must be portfolio-v2 resources.
const outputs = JSON.parse(
  run('terraform', ['-chdir=infra/stack', 'output', '-json']),
) as Record<string, { value: unknown } | undefined>;
const bucket = assertOwnedBucket(outputs['web_bucket']?.value);
const distributionId = assertDistributionId(outputs['distribution_id']?.value);

// The bot check cannot pass without the site's public Turnstile key, so refuse to publish a build without it.
if (
  !hasTurnstileSiteKey(
    readFileSync(
      join(repoRoot, 'apps/web/src/environments/environment.ts'),
      'utf8',
    ),
  )
) {
  fail(
    'turnstileSiteKey is empty in apps/web/src/environments/environment.ts (ADR-052)',
  );
}

// 3. Always build into an empty directory from this commit.
rmSync(join(repoRoot, 'apps/web/dist'), { recursive: true, force: true });
run('npm', ['run', 'build', '-w', '@portfolio/web']);

const built = listFiles(dist);
const conflicts = findConflictCopies(built);
if (conflicts.length > 0)
  fail(`conflict copies in the build output: ${conflicts.join(', ')}`);
if (!built.includes('index.html'))
  fail('index.html is missing from the build output');
if (hasInlineScript(readFileSync(join(dist, 'index.html'), 'utf8'))) {
  fail('index.html contains an inline script, which the production CSP blocks');
}

writeFileSync(
  join(dist, 'version.json'),
  `${JSON.stringify({ sha, builtAt: new Date().toISOString() })}\n`,
);
const files = uploadOrder([...built, 'version.json']);

// 4. Upload in dependency order. No --delete: tabs that are still open keep working with their old hashes.
for (const file of files) {
  const args = [
    's3',
    'cp',
    join(dist, file),
    `s3://${bucket}/${file}`,
    '--cache-control',
    cacheControlFor(file),
    '--only-show-errors',
  ];
  process.stdout.write(
    `${dryRun ? '[dry-run] ' : ''}${file}  (${cacheControlFor(file)})\n`,
  );
  if (!dryRun) run('aws', args);
}

// 5. Invalidate only the files that are not content-addressed.
let invalidation = 'skipped (dry run)';
if (!dryRun) {
  invalidation = run('aws', [
    'cloudfront',
    'create-invalidation',
    '--distribution-id',
    distributionId,
    '--paths',
    '/index.html',
    '/version.json',
    '--query',
    'Invalidation.Id',
    '--output',
    'text',
  ]);
}

const bytes = files.reduce(
  (sum, file) => sum + statSync(join(dist, file)).size,
  0,
);
process.stdout.write(
  `\ndeploy-web record\n  sha:          ${sha}\n  files:        ${files.length} (${bytes} bytes)\n  invalidation: ${invalidation}\n`,
);
