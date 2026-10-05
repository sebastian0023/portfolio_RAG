import { describe, expect, test } from 'vitest';
import { isAllowedSourceUrl } from './knowledge.js';

const hosts = ['example.org', 'github.com'];

describe('isAllowedSourceUrl', () => {
  test('accepts https on an allowed host, ignoring host case', () => {
    expect(isAllowedSourceUrl('https://example.org/a?b=c#d', hosts)).toBe(true);
    expect(isAllowedSourceUrl('https://GitHub.com/owner/repo', hosts)).toBe(
      true,
    );
  });

  test.each([
    ['http://example.org/a', 'plain http'],
    ['javascript:alert(1)', 'a script URL'],
    ['https://evil.example.net/a', 'another host'],
    ['https://example.org.evil.net/a', 'a look-alike suffix'],
    ['https://user:pw@example.org/a', 'credentials'],
    ['https://example.org:8443/a', 'an explicit port'],
    ['not a url', 'garbage'],
  ])('rejects %s (%s)', (value) => {
    expect(isAllowedSourceUrl(value, hosts)).toBe(false);
  });

  test('accepts nothing while the allowlist is empty', () => {
    expect(isAllowedSourceUrl('https://example.org/a')).toBe(false);
  });
});
