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

if (import.meta.main) {
  const file = await buildApiBundle();
  process.stdout.write(`${file}\n`);
}
