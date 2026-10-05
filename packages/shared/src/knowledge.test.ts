import { describe, expect, test } from 'vitest';
import { ALLOWED_SOURCE_HOSTS, isAllowedSourceUrl } from './knowledge.js';

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

  test('the production allowlist is exactly the approved hosts', () => {
    expect(ALLOWED_SOURCE_HOSTS).toEqual(['github.com']);
    expect(
      isAllowedSourceUrl('https://github.com/sebastian0023/relationship-rag'),
    ).toBe(true);
    for (const url of [
      'https://example.org/a',
      'https://gist.github.com/x',
      'https://github.com.evil.net/x',
      'http://github.com/x',
    ]) {
      expect(isAllowedSourceUrl(url), url).toBe(false);
    }
  });
});
