// Bundles the Lambda into one ESM file. The output is deterministic so a plan from CI and a plan from the
// operator's machine hash the same artifact (apply-procedure.md). Run with: npm run build -w @portfolio/api
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const BUNDLE_FILE = 'index.mjs';

// Some AWS SDK dependencies still use require(); the banner keeps them working in an ESM bundle.
const BANNER =
  "import { createRequire as __createRequire } from 'node:module';const require = __createRequire(import.meta.url);";

export async function buildApiBundle(
  outdir = resolve(apiRoot, 'dist/lambda'),
): Promise<string> {
  mkdirSync(outdir, { recursive: true });
  await build({
    absWorkingDir: apiRoot,
    entryPoints: ['src/lambda.ts'],
    outfile: resolve(outdir, BUNDLE_FILE),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    legalComments: 'none',
    minifySyntax: true,
    minifyWhitespace: true,
    banner: { js: BANNER },
    logLevel: 'warning',
  });
  return resolve(outdir, BUNDLE_FILE);
}

// Operator CLIs (ADR-043: each is its own composition root). They are bundled apart from the Lambda so the
// function never carries CLI-only code such as the STS client.
export const CLI_ENTRIES = ['ingest'] as const;

export async function buildCliBundles(
  outdir = resolve(apiRoot, 'dist/cli'),
): Promise<string[]> {
  mkdirSync(outdir, { recursive: true });
  await build({
    absWorkingDir: apiRoot,
    entryPoints: CLI_ENTRIES.map((name) => `src/cli/${name}.ts`),
    outdir,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    legalComments: 'none',
    minifySyntax: true,
    minifyWhitespace: true,
    banner: { js: BANNER },
    logLevel: 'warning',
  });
  return CLI_ENTRIES.map((name) => resolve(outdir, `${name}.mjs`));
}

if (import.meta.main) {
  const file = await buildApiBundle();
  process.stdout.write(`${file}\n`);
}
