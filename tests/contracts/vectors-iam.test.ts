import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// Pins the least-privilege shape of the vector bucket module (ADR-053, R-14, R-16). Terraform does not run in
// unit tests, so this reads the source: a loosening has to change this test in the same pull request.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string): string =>
  readFileSync(resolve(root, path), 'utf8');

const main = read('infra/modules/vectors/main.tf');
const stack = read('infra/stack/main.tf');

// The text between `data "aws_iam_policy_document" "<name>"` and the next top-level block.
function document(name: string): string {
  const start = main.indexOf(`data "aws_iam_policy_document" "${name}"`);
  expect(start, `policy document ${name}`).toBeGreaterThanOrEqual(0);
  const next = main.indexOf('\nresource ', start);
  return main.slice(start, next < 0 ? undefined : next);
}

describe('vector bucket module', () => {
  test('the bucket is protected from destruction', () => {
    expect(main).toMatch(/force_destroy\s*=\s*false/);
    expect(main).toMatch(/prevent_destroy\s*=\s*true/);
  });

  test('nothing in the module can delete an index or vector, or change a bucket policy', () => {
    expect(main).not.toMatch(
      /s3vectors:(Delete|PutVectorBucketPolicy|Update|PutVectorBucketDefault)/,
    );
    expect(main).not.toMatch(/"s3vectors:\*"/);
  });

  test('the ingest role cannot write SSM and reads only the active index name', () => {
    const ingest = document('ingest');
    expect(ingest).not.toMatch(/ssm:Put/);
    expect(ingest).toMatch(/ssm:GetParameter"/);
    expect(ingest).toMatch(/\/active_index"/);
    expect(ingest).not.toMatch(/parameter\$\{var\.parameter_prefix\}\/\*/);
  });

  test('the eval role reads only the four non-secret parameters', () => {
    const evaluation = document('eval');
    for (const name of [
      'chat_enabled',
      'active_index',
      'llm_config',
      'limits',
    ]) {
      expect(evaluation).toContain(`/${name}"`);
    }
    expect(evaluation).not.toMatch(/turnstile_secret|guest_pass_key/);
    expect(evaluation).not.toMatch(/\/\*"/);
  });

  test('only the operator role can assume the ingest and eval roles', () => {
    expect(main).toMatch(/identifiers = \[var\.operator_role_arn\]/);
    expect(main.match(/assume_role_policy\s*=/g)).toHaveLength(2);
  });

  test('model calls use the Titan model ARN, never a wildcard', () => {
    expect(main).toContain('foundation-model/amazon.titan-embed-text-v2:0');
    expect(main).not.toMatch(/bedrock:[A-Za-z]+"[^]*resources\s*=\s*\["\*"\]/);
  });
});

describe('stack wiring', () => {
  test('the ingest and eval roles are kill-switch targets', () => {
    expect(stack).toMatch(
      /additional_kill_target_roles\s*=\s*\[[^\]]*module\.vectors\.ingest_role_name[^\]]*module\.vectors\.eval_role_name[^\]]*\]/,
    );
  });
});
