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
  deferred: Record<string, { type: string; phase: number }>;
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

  test('the secret is deferred, named only, and has no value in source', () => {
    expect(manifest.deferred.turnstile_secret).toMatchObject({
      type: 'SecureString',
      phase: 4,
    });
    expect(Object.values(manifest.parameters).some((p) => 'type' in p)).toBe(
      false,
    );
    expect(manifest.deferred.turnstile_secret).not.toHaveProperty('value');
    expect(manifest.deferred.turnstile_secret).not.toHaveProperty('default');
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
});
