import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const headers = JSON.parse(
  readFileSync(
    resolve(root, 'infra/modules/edge/security-headers.json'),
    'utf8',
  ),
) as { spa: Record<string, string>; api: Record<string, string> };
const edgeTf = readFileSync(
  resolve(root, 'infra/modules/edge/main.tf'),
  'utf8',
);

const directives = (csp: string): Map<string, string[]> =>
  new Map(
    csp
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name as string, values]),
  );

describe('edge security headers (P3-06)', () => {
  const spa = directives(headers.spa['content-security-policy'] as string);

  test('scripts load only from this origin and never eval', () => {
    expect(spa.get('script-src')).toEqual(["'self'"]);
    for (const [name, values] of spa) {
      expect(values, name).not.toContain("'unsafe-eval'");
    }
    expect(spa.get('script-src')).not.toContain("'unsafe-inline'");
  });

  test('the page can only call its own origin and cannot be framed', () => {
    expect(spa.get('connect-src')).toEqual(["'self'"]);
    expect(spa.get('frame-ancestors')).toEqual(["'none'"]);
    expect(spa.get('object-src')).toEqual(["'none'"]);
    expect(spa.get('base-uri')).toEqual(["'self'"]);
    expect(spa.get('form-action')).toEqual(["'self'"]);
    expect(spa.has('upgrade-insecure-requests')).toBe(true);
  });

  test('no directive allows a remote origin or a wildcard', () => {
    for (const [name, values] of spa) {
      for (const value of values) {
        expect(value, name).not.toMatch(/^https?:/);
        expect(value, name).not.toBe('*');
      }
    }
  });

  test('inline styles are the one allowance and are explicit', () => {
    // Angular injects component styles at runtime. Revisit with a nonce if the framework gains support.
    expect(spa.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
  });

  test('both policies set HSTS for at least a year, nosniff, and frame denial', () => {
    for (const policy of [headers.spa, headers.api]) {
      const maxAge = /max-age=(\d+)/.exec(
        policy['strict-transport-security'] ?? '',
      );
      expect(Number(maxAge?.[1])).toBeGreaterThanOrEqual(31_536_000);
      expect(policy['x-content-type-options']).toBe('nosniff');
      expect(policy['x-frame-options']).toBe('DENY');
    }
  });

  test('API responses are never cached and carry no usable CSP surface', () => {
    expect(headers.api['cache-control']).toBe('no-store');
    expect(
      directives(headers.api['content-security-policy'] as string).get(
        'default-src',
      ),
    ).toEqual(["'none'"]);
  });

  test('the SPA policy denies powerful browser features', () => {
    for (const feature of [
      'camera',
      'microphone',
      'geolocation',
      'payment',
      'usb',
    ]) {
      expect(headers.spa['permissions-policy']).toContain(`${feature}=()`);
    }
  });

  test('Terraform reads the same file and attaches a policy to each behavior', () => {
    expect(edgeTf).toContain('security-headers.json');
    expect(edgeTf).toContain(
      'response_headers_policy_id = aws_cloudfront_response_headers_policy.spa.id',
    );
    expect(edgeTf).toContain(
      'response_headers_policy_id = aws_cloudfront_response_headers_policy.api.id',
    );
  });

  test('the Terraform HSTS value agrees with the shared file', () => {
    const tfAge = /access_control_max_age_sec\s*=\s*(\d+)/.exec(edgeTf);
    const fileAge = /max-age=(\d+)/.exec(
      headers.spa['strict-transport-security'] ?? '',
    );
    expect(tfAge?.[1]).toBe(fileAge?.[1]);
  });

  test('there is no distribution-wide error mapping that could swallow API failures (ADR-013)', () => {
    expect(edgeTf).not.toMatch(/^\s*custom_error_response\s*\{/m);
  });
});
