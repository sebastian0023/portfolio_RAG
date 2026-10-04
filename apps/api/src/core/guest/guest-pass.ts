import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// A guest pass proves that one visitor passed the Turnstile check recently (ADR-052). It is bound to the
// visitor's IP bucket so a pass cannot be handed to another network, and it is signed with a server-only key,
// so it cannot be forged or extended. Format: `v1.<base64url payload>.<base64url HMAC-SHA256>`.
export const PASS_TTL_SECONDS = 3600;
const VERSION = 'v1';

const payloadSchema = z.strictObject({
  // Fingerprint of the visitor's IP bucket (the same value the counters use).
  k: z.string().min(1).max(64),
  // Expiry, epoch seconds.
  exp: z.number().int().min(1),
});

const b64 = (data: string | Buffer): string =>
  Buffer.from(data).toString('base64url');

function sign(key: string, signingInput: string): Buffer {
  return createHmac('sha256', key).update(signingInput).digest();
}

export interface IssuedPass {
  readonly pass: string;
  readonly expiresAt: number;
}

export function issuePass(
  key: string,
  bucketFingerprint: string,
  nowMs: number,
): IssuedPass {
  const expiresAt = Math.floor(nowMs / 1000) + PASS_TTL_SECONDS;
  const payload = b64(JSON.stringify({ k: bucketFingerprint, exp: expiresAt }));
  const signingInput = `${VERSION}.${payload}`;
  return { pass: `${signingInput}.${b64(sign(key, signingInput))}`, expiresAt };
}

export type PassVerdict = 'valid' | 'invalid' | 'expired';

// Anything malformed, forged, signed with another key, or issued to another IP bucket is `invalid`. Only a
// genuine pass for this visitor whose time ran out is `expired`, so the UI can tell "check again" from garbage.
export function verifyPass(
  key: string,
  pass: string,
  bucketFingerprint: string,
  nowMs: number,
): PassVerdict {
  const parts = pass.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return 'invalid';
  const [version, payload, signature] = parts as [string, string, string];

  const expected = sign(key, `${version}.${payload}`);
  const given = Buffer.from(signature, 'base64url');
  // timingSafeEqual needs equal lengths; a wrong length is simply invalid.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return 'invalid';
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return 'invalid';
  }
  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.k !== bucketFingerprint) return 'invalid';
  return parsed.data.exp * 1000 > nowMs ? 'valid' : 'expired';
}
