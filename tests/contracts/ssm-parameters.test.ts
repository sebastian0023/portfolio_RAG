import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { MAX_REQUEST_BYTES } from '@portfolio/shared';
import {
  PARAMETER_NAMES,
  parseRuntimeConfig,
} from '../../apps/api/src/core/config/runtime-config.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = resolve(root, 'infra/modules/ssm/parameters.json');
const text = readFileSync(manifestPath, 'utf8');

interface Entry {
  managed: string;
  format: 'boolean' | 'string' | 'json';
  description: string;
  default: unknown;
}
const manifest = JSON.parse(text) as {
  prefix: string;
  parameters: Record<string, Entry>;
  secrets: Record<string, { description: string }>;
};

const asSsmValue = (entry: Entry): string =>
  entry.format === 'json'
    ? JSON.stringify(entry.default)
    : String(entry.default);

describe('SSM parameter contract (P1-07)', () => {
  test('manifest names match the names the schema reads', () => {
    expect(Object.keys(manifest.parameters).sort()).toEqual(
      [...PARAMETER_NAMES].sort(),
    );
  });

  test('every default parses through the real schema', () => {
    const raw = Object.fromEntries(
      Object.entries(manifest.parameters).map(([name, entry]) => [
        name,
        asSsmValue(entry),
      ]),
    );
    const result = parseRuntimeConfig(raw);
    expect(result).toMatchObject({ ok: true });
  });

  test('chat starts disabled and no index is live', () => {
    expect(manifest.parameters.chat_enabled?.default).toBe(false);
    expect(manifest.parameters.active_index?.default).toBe('none');
  });

  test('parameters live under the portfolio-v2 prefix', () => {
    expect(manifest.prefix).toBe('/portfolio-v2/prod');
  });

  test('operator-changed parameters are not forced back by Terraform', () => {
    for (const name of ['chat_enabled', 'active_index', 'llm_config']) {
      expect(manifest.parameters[name]?.managed).toBe('operator');
    }
    expect(manifest.parameters.limits?.managed).toBe('terraform');
  });

  test('secrets are named only: no value, no default, no type in source', () => {
    expect(Object.keys(manifest.secrets).sort()).toEqual([
      'guest_pass_key',
      'turnstile_secret',
    ]);
    for (const [name, entry] of Object.entries(manifest.secrets)) {
      expect(Object.keys(entry), name).toEqual(['description']);
      expect(entry.description.length).toBeGreaterThan(20);
    }
    expect(Object.values(manifest.parameters).some((p) => 'type' in p)).toBe(
      false,
    );
  });

  test('secrets never share a name with a runtime parameter, and the file holds no secret-looking value', () => {
    for (const name of Object.keys(manifest.secrets)) {
      expect(manifest.parameters).not.toHaveProperty(name);
    }
    expect(text).not.toMatch(/[A-Za-z0-9+/]{40,}/);
  });

  test('the Terraform module creates secrets as SecureString placeholders that it never overwrites', () => {
    const tf = readFileSync(resolve(root, 'infra/modules/ssm/main.tf'), 'utf8');
    const block = /resource "aws_ssm_parameter" "secret" \{[\s\S]*?\n\}/.exec(
      tf,
    )?.[0];
    expect(block).toContain('type        = "SecureString"');
    expect(block).toContain('value       = "unset"');
    expect(block).toContain('ignore_changes = [value]');
  });

  test('every parameter documents its purpose', () => {
    for (const entry of Object.values(manifest.parameters)) {
      expect(entry.description.length).toBeGreaterThan(20);
    }
  });

  describe('Phase 3 limits stay inside what the platform allows', () => {
    const limits = manifest.parameters.limits?.default as Record<
      string,
      number
    >;

    test('the global pre-auth rate stays under the Haiku cross-region quota of 50 requests a minute', () => {
      // docs/operations/model-probe.md: one request per minute beyond this is throttled by Bedrock itself.
      expect(limits.preAuthGlobalPerMinute).toBeLessThanOrEqual(50);
    });

    test('output is capped at 400 tokens (ADR-024)', () => {
      expect(limits.outputMaxTokens).toBeLessThanOrEqual(400);
    });

    test('the request byte cap in SSM matches the shared wire constant', () => {
      expect(limits.requestMaxBytes).toBe(MAX_REQUEST_BYTES);
    });

    test('the model deadline leaves room inside the Lambda timeout', () => {
      // infra/stack passes timeoutSeconds + 5 to the function; the origin read timeout is 60 s.
      expect((limits.timeoutSeconds ?? 0) + 5).toBeLessThanOrEqual(60);
    });
  });

  test('the worst-case monthly spend of the global quota fits the Bedrock budget (ADR-051)', () => {
    const limits = manifest.parameters.limits?.default as Record<
      string,
      number
    >;
    const variables = readFileSync(
      resolve(root, 'infra/modules/budgets/variables.tf'),
      'utf8',
    );
    const budget = Number(
      /variable "bedrock_budget_usd"[\s\S]*?default\s*=\s*(\d+)/.exec(
        variables,
      )?.[1],
    );
    const WORST_CASE_PER_ANSWER_USD = 0.0088; // abuse-budgets.md
    const worstMonth =
      (limits.globalPerDay ?? 0) * 30 * WORST_CASE_PER_ANSWER_USD;
    expect(worstMonth).toBeLessThanOrEqual(budget);
  });

  test('one guest cannot use more than the whole site quota', () => {
    const limits = manifest.parameters.limits?.default as Record<
      string,
      number
    >;
    expect(limits.guestPerIpPerDay).toBeLessThanOrEqual(
      limits.globalPerDay ?? 0,
    );
    expect(limits).not.toHaveProperty('userPerDay');
  });
});
