import { AUTH_HEADER } from '@portfolio/shared';
import type { AdmissionStage } from '../chat/admission.js';
import { reject } from '../chat/rejection.js';
import { verifyPass } from '../guest/guest-pass.js';
import type { CachedSecrets } from '../guest/secrets.js';
import type { CounterStore } from './counter-store.js';
import { clientKeyFrom, VIEWER_ADDRESS_HEADER } from './trusted-ip.js';
import {
  dayWindow,
  expiresAtSeconds,
  fingerprint,
  globalDayKey,
  ipDayKey,
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
  ctx.viewerIp = result.ip;
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

// The daily quota (ADR-051): 10 questions per visitor IP bucket and 50 for the whole site, reserved together in
// one atomic transaction before the first paid call and never refunded, so a disconnect still counts. A refused
// visitor does not use up site capacity. Which limit was hit decides the refusal: the visitor's own
// (`quota_exhausted`) or the site's (`site_limit`).
export function guestQuotaStage(
  store: CounterStore,
  now: () => number = Date.now,
): AdmissionStage {
  return async (ctx) => {
    const limits = ctx.config?.limits;
    if (!limits || !ctx.clientKey) return reject('unavailable');
    const window = dayWindow(now());
    const expiresAt = expiresAtSeconds(window, 'day');
    const ipKey = ipDayKey(ctx.clientKey, window);
    try {
      const result = await store.reserveAll([
        { key: ipKey, limit: limits.guestPerIpPerDay, expiresAt },
        { key: globalDayKey(window), limit: limits.globalPerDay, expiresAt },
      ]);
      if (!result.ok) {
        return reject(
          result.exceededIndex === 0 ? 'quota_exhausted' : 'site_limit',
        );
      }
      // The visitor's own count, read back consistently. A concurrent request from the same IP can make it
      // one or two lower than the strict remainder, which only ever under-reports what is left.
      const used = await store.read(ipKey);
      ctx.quota = {
        left: Math.max(0, limits.guestPerIpPerDay - used),
        limit: limits.guestPerIpPerDay,
      };
      return undefined;
    } catch {
      return reject('unavailable');
    }
  };
}

// Requires a valid guest pass (ADR-052), sent in X-Auth-Token. A missing, forged, expired, or other-network pass
// is `guest_check_failed`, which makes the browser run the bot check again. An unreadable secret refuses the
// request instead (fail closed). Runs after chat_enabled and before anything is resolved or reserved.
export function guestPassStage(
  secrets: CachedSecrets,
  now: () => number = Date.now,
): AdmissionStage {
  return async (ctx) => {
    if (!ctx.clientKey) return reject('unavailable');
    const state = await secrets.get();
    if (state.status !== 'ready') return reject('unavailable');
    const pass = ctx.headers.get(AUTH_HEADER);
    if (!pass) return reject('guest_check_failed');
    const verdict = verifyPass(
      state.secrets.guestPassKey,
      pass,
      fingerprint(ctx.clientKey),
      now(),
    );
    return verdict === 'valid' ? undefined : reject('guest_check_failed');
  };
}
