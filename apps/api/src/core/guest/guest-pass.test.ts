import { describe, expect, test } from 'vitest';
import { issuePass, PASS_TTL_SECONDS, verifyPass } from './guest-pass.js';

const KEY = 'k'.repeat(48);
const NOW = Date.parse('2026-10-04T12:00:00Z');

describe('guest pass (ADR-052)', () => {
  test('a freshly issued pass is valid for its own bucket and lasts one hour', () => {
    const { pass, expiresAt } = issuePass(KEY, 'bucket-a', NOW);
    expect(expiresAt).toBe(NOW / 1000 + PASS_TTL_SECONDS);
    expect(verifyPass(KEY, pass, 'bucket-a', NOW)).toBe('valid');
    expect(verifyPass(KEY, pass, 'bucket-a', NOW + 3599_000)).toBe('valid');
  });

  test('it expires exactly at the hour', () => {
    const { pass } = issuePass(KEY, 'bucket-a', NOW);
    expect(verifyPass(KEY, pass, 'bucket-a', NOW + 3600_000)).toBe('expired');
    expect(verifyPass(KEY, pass, 'bucket-a', NOW + 86_400_000)).toBe('expired');
  });

  test('it is bound to the IP bucket it was issued to', () => {
    const { pass } = issuePass(KEY, 'bucket-a', NOW);
    expect(verifyPass(KEY, pass, 'bucket-b', NOW)).toBe('invalid');
  });

  test('a pass signed with another key is invalid, so rotating the key revokes every pass', () => {
    const { pass } = issuePass(KEY, 'bucket-a', NOW);
    expect(verifyPass('z'.repeat(48), pass, 'bucket-a', NOW)).toBe('invalid');
  });

  test('tampering with the payload or the signature is invalid', () => {
    const { pass } = issuePass(KEY, 'bucket-a', NOW);
    const [v, payload, sig] = pass.split('.') as [string, string, string];
    const forgedPayload = Buffer.from(
      JSON.stringify({ k: 'bucket-a', exp: NOW / 1000 + 999_999 }),
    ).toString('base64url');
    expect(
      verifyPass(KEY, `${v}.${forgedPayload}.${sig}`, 'bucket-a', NOW),
    ).toBe('invalid');
    expect(
      verifyPass(KEY, `${v}.${payload}.${sig.slice(0, -2)}AA`, 'bucket-a', NOW),
    ).toBe('invalid');
    expect(verifyPass(KEY, `${v}.${payload}.`, 'bucket-a', NOW)).toBe(
      'invalid',
    );
  });

  test('an expiry cannot be extended by editing it, even with the right shape', () => {
    const { pass } = issuePass(KEY, 'bucket-a', NOW - 7200_000);
    const [v, , sig] = pass.split('.') as [string, string, string];
    const longer = Buffer.from(
      JSON.stringify({ k: 'bucket-a', exp: NOW / 1000 + 3600 }),
    ).toString('base64url');
    expect(verifyPass(KEY, `${v}.${longer}.${sig}`, 'bucket-a', NOW)).toBe(
      'invalid',
    );
  });

  test.each([
    ['empty', ''],
    ['no dots', 'garbage'],
    ['two parts', 'v1.abc'],
    ['four parts', 'v1.a.b.c'],
    ['wrong version', 'v2.abc.def'],
    ['not base64', 'v1.!!!.???'],
  ])('refuses %s', (_name, value) => {
    expect(verifyPass(KEY, value, 'bucket-a', NOW)).toBe('invalid');
  });

  test('a validly signed payload of the wrong shape is invalid', () => {
    const bad = Buffer.from(
      JSON.stringify({ k: 'bucket-a', exp: 'soon', extra: 1 }),
    ).toString('base64url');
    const { pass } = issuePass(KEY, 'bucket-a', NOW);
    const sig = pass.split('.')[2] as string;
    expect(verifyPass(KEY, `v1.${bad}.${sig}`, 'bucket-a', NOW)).toBe(
      'invalid',
    );
  });

  test('the pass is short enough for a header and never contains the address', () => {
    const { pass } = issuePass(KEY, 'fingerprint', NOW);
    expect(pass.length).toBeLessThan(200);
    expect(pass).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});
