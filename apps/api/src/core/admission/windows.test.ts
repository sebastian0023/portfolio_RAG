import { describe, expect, test } from 'vitest';
import {
  dayWindow,
  expiresAtSeconds,
  fingerprint,
  globalDayKey,
  globalMinuteKey,
  ipMinuteKey,
  minuteWindow,
  retryAfterSeconds,
} from './windows.js';

const at = (iso: string): number => Date.parse(iso);

describe('counter windows (ADR-017)', () => {
  test('a minute window is the UTC minute and ends at the next one', () => {
    const w = minuteWindow(at('2026-10-04T12:34:56.789Z'));
    expect(w.id).toBe('202610041234');
    expect(w.endsAtMs).toBe(at('2026-10-04T12:35:00Z'));
  });

  test('the last millisecond of a minute still belongs to it; the next starts a new key', () => {
    expect(minuteWindow(at('2026-10-04T12:34:59.999Z')).id).toBe(
      '202610041234',
    );
    expect(minuteWindow(at('2026-10-04T12:35:00.000Z')).id).toBe(
      '202610041235',
    );
  });

  test('windows roll over hour, day, month, and year boundaries', () => {
    expect(minuteWindow(at('2026-12-31T23:59:59Z')).id).toBe('202612312359');
    expect(minuteWindow(at('2027-01-01T00:00:00Z')).id).toBe('202701010000');
    expect(dayWindow(at('2026-02-28T23:59:59.999Z')).id).toBe('20260228');
    expect(dayWindow(at('2026-03-01T00:00:00Z')).id).toBe('20260301');
  });

  test('a day window is the UTC day, whatever the local time zone', () => {
    const w = dayWindow(at('2026-10-04T23:30:00Z'));
    expect(w.id).toBe('20261004');
    expect(w.endsAtMs).toBe(at('2026-10-05T00:00:00Z'));
  });

  test('keys carry the window and never the raw address', () => {
    const w = minuteWindow(at('2026-10-04T12:34:00Z'));
    const key = ipMinuteKey('v4:203.0.113.9', w);
    expect(key).toBe(`rate#ip#${fingerprint('v4:203.0.113.9')}#202610041234`);
    expect(key).not.toContain('203.0.113.9');
    expect(globalMinuteKey(w)).toBe('rate#global#202610041234');
    expect(globalDayKey(dayWindow(at('2026-10-04T12:00:00Z')))).toBe(
      'quota#global#20261004',
    );
  });

  test('different clients and different minutes never share a key', () => {
    const w1 = minuteWindow(at('2026-10-04T12:34:00Z'));
    const w2 = minuteWindow(at('2026-10-04T12:35:00Z'));
    expect(ipMinuteKey('v4:1.1.1.1', w1)).not.toBe(
      ipMinuteKey('v4:1.1.1.2', w1),
    );
    expect(ipMinuteKey('v4:1.1.1.1', w1)).not.toBe(
      ipMinuteKey('v4:1.1.1.1', w2),
    );
  });

  test('retryAfter counts whole seconds to the window end and is at least 1', () => {
    const w = minuteWindow(at('2026-10-04T12:34:00Z'));
    expect(retryAfterSeconds(w, at('2026-10-04T12:34:00Z'))).toBe(60);
    expect(retryAfterSeconds(w, at('2026-10-04T12:34:30.500Z'))).toBe(30);
    expect(retryAfterSeconds(w, at('2026-10-04T12:34:59.999Z'))).toBe(1);
    expect(retryAfterSeconds(w, at('2026-10-04T12:35:05Z'))).toBe(1);
  });

  test('TTL outlives the window end by a margin', () => {
    const minute = minuteWindow(at('2026-10-04T12:34:00Z'));
    expect(expiresAtSeconds(minute, 'minute')).toBe(
      minute.endsAtMs / 1000 + 120,
    );
    const day = dayWindow(at('2026-10-04T12:34:00Z'));
    expect(expiresAtSeconds(day, 'day')).toBe(day.endsAtMs / 1000 + 7200);
  });
});
