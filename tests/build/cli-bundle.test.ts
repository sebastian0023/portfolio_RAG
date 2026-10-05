import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  buildApiBundle,
  buildCliBundles,
} from '../../apps/api/scripts/build.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = join(root, 'apps/api/src/testing/fixtures/knowledge/valid');
const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-bundle-'));
  dirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

// A working directory holding a copy of the synthetic corpus without its `url:` lines: the production host
// allowlist is empty until the owner approves hosts, so a linked fixture would be rejected.
function workdir(): string {
  const cwd = scratch();
  cpSync(fixtures, join(cwd, 'knowledge'), { recursive: true });
  const strip = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) strip(path);
      else {
        const text = readFileSync(path, 'utf8')
          .split('\n')
          .filter((line) => !line.startsWith('url:'))
          .join('\n');
        writeFileSync(path, text);
      }
    }
  };
  strip(join(cwd, 'knowledge'));
  mkdirSync(join(cwd, 'unused'));
  return cwd;
}

// No credentials of any kind, and no metadata endpoint lookup, so a call that needs AWS fails fast.
const NO_AWS = {
  PATH: process.env['PATH'] ?? '',
  HOME: scratch(),
  AWS_EC2_METADATA_DISABLED: 'true',
  AWS_CONFIG_FILE: '/dev/null',
  AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
  AWS_REGION: 'us-east-1',
};

describe('operator CLI bundle', () => {
  let cli = '';
  beforeAll(async () => {
    [cli = ''] = await buildCliBundles(scratch());
  });

  const exec = (args: string[], cwd: string) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd,
      env: NO_AWS,
      encoding: 'utf8',
      timeout: 30_000,
    });

  test('a dry run needs no credentials and pins the index name of the synthetic corpus', () => {
    const cwd = workdir();
    const result = exec([], cwd);
    expect(result.status, result.stderr).toBe(0);
    const plan = JSON.parse(result.stdout.split('\n}')[0] + '\n}') as {
      mode: string;
      indexName: string;
      chunks: number;
    };
    expect(plan.mode).toBe('dry-run');
    // Changing the corpus fixtures, any pinned config, or the chunker changes this name on purpose.
    expect(plan.indexName).toBe('chunks-3e60f305998598c4');
    expect(existsSync(join(cwd, 'evals'))).toBe(false);
  });

  test('--apply without credentials fails before writing anything', () => {
    const cwd = workdir();
    const result = exec(['--apply'], cwd);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('portfolio-v2-prod-ingest');
    expect(existsSync(join(cwd, 'evals'))).toBe(false);
  });

  test('refuses a corpus with a finding and prints rule and line only', () => {
    const cwd = workdir();
    const target = join(cwd, 'knowledge/faq.md');
    const secret = `ghp_${'k'.repeat(30)}`;
    writeFileSync(
      target,
      `${readFileSync(target, 'utf8')}\nToken ${secret} here.\n`,
    );
    const result = exec([], cwd);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('secret');
    expect(result.stderr).not.toContain(secret);
  });
});

describe('Lambda bundle', () => {
  test('carries no CLI-only code: no STS client and no caller-identity check', async () => {
    const file = await buildApiBundle(scratch());
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('GetCallerIdentity');
    expect(text).not.toContain('assumed-role');
  });
});
