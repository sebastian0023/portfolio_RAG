import { describe, expect, test } from 'vitest';
import { clientKeyFrom } from './trusted-ip.js';

describe('trusted viewer address (ADR-016, R-15)', () => {
  test('keys an IPv4 viewer by its address', () => {
    expect(clientKeyFrom('203.0.113.9:46532')).toMatchObject({
      ok: true,
      key: 'v4:203.0.113.9',
    });
  });

  test('hands back the raw viewer address only for the bot check', () => {
    expect(clientKeyFrom('203.0.113.9:46532')).toMatchObject({
      ip: '203.0.113.9',
    });
    expect(clientKeyFrom('[2001:db8:85a3::8a2e:370:7334]:46532')).toMatchObject(
      {
        ip: '2001:db8:85a3::8a2e:370:7334',
      },
    );
    expect(clientKeyFrom('::ffff:203.0.113.9:5000')).toMatchObject({
      ip: '203.0.113.9',
    });
  });

  test('keys an IPv6 viewer by its /64, with and without brackets', () => {
    const key = { ok: true, key: 'v6:2001:db8:85a3:0' };
    expect(
      clientKeyFrom('2001:db8:85a3:0:0:8a2e:370:7334:46532'),
    ).toMatchObject(key);
    expect(clientKeyFrom('[2001:db8:85a3::8a2e:370:7334]:46532')).toMatchObject(
      key,
    );
    expect(
      clientKeyFrom('2001:db8:85a3:0:ffff:ffff:ffff:ffff:1'),
    ).toMatchObject(key);
  });

  test('two hosts in one /64 share a bucket; another /64 does not', () => {
    const a = clientKeyFrom('2001:db8:1:1::1:5000');
    const b = clientKeyFrom('2001:db8:1:1:aaaa::2:5000');
    const c = clientKeyFrom('2001:db8:1:2::1:5000');
    expect(a).toMatchObject({ ok: true });
    expect(a.ok && b.ok && a.key === b.key).toBe(true);
    expect(a.ok && c.ok && a.key === c.key).toBe(false);
  });

  test('expands a compressed address that starts with ::', () => {
    expect(clientKeyFrom('::1:5000')).toMatchObject({
      ok: true,
      key: 'v6:0:0:0:0',
    });
  });

  test('treats an IPv4-mapped IPv6 address as that IPv4 address', () => {
    expect(clientKeyFrom('::ffff:203.0.113.9:5000')).toMatchObject({
      ok: true,
      key: 'v4:203.0.113.9',
    });
  });

  test.each([
    ['missing', null],
    ['empty', ''],
    ['no port', '203.0.113.9'],
    ['comma-separated list', '203.0.113.9:1, 198.51.100.1:2'],
    ['bad port', '203.0.113.9:99999'],
    ['zero port', '203.0.113.9:0'],
    ['non-numeric port', '203.0.113.9:http'],
    ['not an address', 'not-an-ip:5000'],
    ['octet out of range', '256.1.1.1:5000'],
    ['too many groups', '1:2:3:4:5:6:7:8:9:5000'],
    ['two compressions', '1::2::3:5000'],
    ['hostname', 'example.com:443'],
  ])('refuses %s', (_name, value) => {
    expect(clientKeyFrom(value)).toEqual({ ok: false });
  });
});
