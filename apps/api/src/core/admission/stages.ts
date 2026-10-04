import type { AdmissionStage } from '../chat/admission.js';
import { reject } from '../chat/rejection.js';
import type { CounterStore } from './counter-store.js';
import { clientKeyFrom, VIEWER_ADDRESS_HEADER } from './trusted-ip.js';
import {
  dayWindow,
  expiresAtSeconds,
  globalDayKey,
  globalMinuteKey,
  ipMinuteKey,
  minuteWindow,
  retryAfterSeconds,
} from './windows.js';

// Resolves the viewer from the edge-supplied address only. A missing or ambiguous address is refused rather
// than guessed, because the per-IP limit is the only pre-auth brake (ADR-016).
export const trustedIpStage: AdmissionStage = (ctx) => {
  const result = clientKeyFrom(ctx.headers.get(VIEWER_ADDRESS_HEADER));
  if (!result.ok) return Promise.resolve(reject('unavailable'));
  ctx.clientKey = result.key;
  return Promise.resolve(undefined);
};

// Per-IP and global per-minute limits, reserved together. This runs before the chat_enabled check on purpose:
// it needs no model, so the limit can be exercised with chat switched off. Every paid step still sits behind
// chat_enabled, and a store failure refuses the request.
export function preAuthRateStage(
  store: CounterStore,
  now: () => number = Date.now,
): AdmissionStage {
  return async (ctx) => {
    const limits = ctx.config?.limits;
    if (!limits || !ctx.clientKey) return reject('unavailable');
    const nowMs = now();
    const window = minuteWindow(nowMs);
    const expiresAt = expiresAtSeconds(window, 'minute');
    try {
      const result = await store.reserveAll([
        {
          key: ipMinuteKey(ctx.clientKey, window),
          limit: limits.preAuthPerIpPerMinute,
          expiresAt,
        },
        {
          key: globalMinuteKey(window),
          limit: limits.preAuthGlobalPerMinute,
          expiresAt,
        },
      ]);
      if (result.ok) return undefined;
      return reject('rate_limited', {
        retryAfterSeconds: retryAfterSeconds(window, nowMs),
      });
    } catch {
      return reject('unavailable');
    }
  };
}

// chat_enabled gates every paid step (ADR-027). The value is from the config loaded in this request, so the
// operator's switch takes effect within the config cache TTL.
export const chatEnabledStage: AdmissionStage = (ctx) =>
  Promise.resolve(
    ctx.config?.chatEnabled === true ? undefined : reject('unavailable'),
  );

// Temporary site-wide daily cap (ADR-050): a hard stop on spend until Phase 4 adds per-principal quotas. The
// reservation happens before the first paid call and is never refunded, so a disconnect still counts.
export function dailyCapStage(
  store: CounterStore,
  now: () => number = Date.now,
): AdmissionStage {
  return async (ctx) => {
    const limits = ctx.config?.limits;
    if (!limits) return reject('unavailable');
    const window = dayWindow(now());
    try {
      const result = await store.reserve({
        key: globalDayKey(window),
        limit: limits.globalPerDay,
        expiresAt: expiresAtSeconds(window, 'day'),
      });
      if (!result.ok) return reject('site_limit');
      ctx.quota = {
        left: Math.max(0, limits.globalPerDay - result.count),
        limit: limits.globalPerDay,
      };
      return undefined;
    } catch {
      return reject('unavailable');
    }
  };
}
