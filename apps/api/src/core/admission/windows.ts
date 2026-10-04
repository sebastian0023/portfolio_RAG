import { createHash } from 'node:crypto';

// Counter keys carry their window (ADR-017). DynamoDB TTL is only cleanup and can lag by a day or more, so
// an expired item is never trusted to reset a count: a new window is a new key.
export interface Window {
  readonly id: string;
  readonly endsAtMs: number;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export function minuteWindow(nowMs: number): Window {
  const d = new Date(nowMs);
  const start = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
  );
  return {
    id: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`,
    endsAtMs: start + 60_000,
  };
}

export function dayWindow(nowMs: number): Window {
  const d = new Date(nowMs);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return {
    id: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`,
    endsAtMs: start + 86_400_000,
  };
}

// The raw address never reaches the table or the logs; only a short hash of the bucket key does.
export function fingerprint(clientKey: string): string {
  return createHash('sha256').update(clientKey).digest('hex').slice(0, 32);
}

export const ipMinuteKey = (clientKey: string, window: Window): string =>
  `rate#ip#${fingerprint(clientKey)}#${window.id}`;

export const globalMinuteKey = (window: Window): string =>
  `rate#global#${window.id}`;

// Phase 4 reuses this key for the global daily limit.
export const globalDayKey = (window: Window): string =>
  `quota#global#${window.id}`;

// Items outlive their window by a margin so a slow clock or a late write cannot hit a deleted item.
const MINUTE_TTL_MARGIN_S = 120;
const DAY_TTL_MARGIN_S = 7_200;

export const expiresAtSeconds = (
  window: Window,
  kind: 'minute' | 'day',
): number =>
  Math.ceil(window.endsAtMs / 1000) +
  (kind === 'minute' ? MINUTE_TTL_MARGIN_S : DAY_TTL_MARGIN_S);

export function retryAfterSeconds(window: Window, nowMs: number): number {
  return Math.max(1, Math.ceil((window.endsAtMs - nowMs) / 1000));
}
