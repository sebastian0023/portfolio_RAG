import { isIP } from 'node:net';

// The only trusted source of the viewer's address is the CloudFront-Viewer-Address header that the edge adds
// (ADR-016, R-15). It is `<ip>:<port>`. Through OAC the Lambda event's own sourceIp is CloudFront, and
// X-Forwarded-For is client-controlled, so neither is ever read. Anything missing or ambiguous is refused.
export const VIEWER_ADDRESS_HEADER = 'cloudfront-viewer-address';

export type ClientKeyResult =
  { readonly ok: true; readonly key: string } | { readonly ok: false };

const PORT = /^[0-9]{1,5}$/;

// Expands an IPv6 address to its eight 16-bit groups, or returns null if it is not a plain address.
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  // A dotted IPv4 tail (::ffff:1.2.3.4) stands for the last two groups.
  const dotted = text.match(/^(.*:)([0-9.]+)$/);
  if (dotted?.[2]?.includes('.')) {
    const parts = dotted[2].split('.').map(Number);
    if (
      parts.length !== 4 ||
      parts.some((p) => !Number.isInteger(p) || p > 255)
    )
      return null;
    const high = ((parts[0] ?? 0) << 8) | (parts[1] ?? 0);
    const low = ((parts[2] ?? 0) << 8) | (parts[3] ?? 0);
    text = `${dotted[1] ?? ''}${high.toString(16)}:${low.toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): string[] =>
    part === '' ? [] : part.split(':');
  const head = toGroups(halves[0] ?? '');
  const tail = halves.length === 2 ? toGroups(halves[1] ?? '') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill('0'),
    ...tail,
  ];
  const groups = all.map((g) =>
    /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN,
  );
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g))
    ? groups
    : null;
}

// One bucket per IPv4 address, and one per IPv6 /64: a single host can rotate addresses inside its /64, so a
// narrower key would let it dodge the per-IP limit.
export function clientKeyFrom(address: string | null): ClientKeyResult {
  if (address === null || address.includes(',')) return { ok: false };
  const separator = address.lastIndexOf(':');
  if (separator < 1) return { ok: false };
  const port = address.slice(separator + 1);
  if (!PORT.test(port) || Number(port) < 1 || Number(port) > 65535)
    return { ok: false };

  let ip = address.slice(0, separator);
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);

  const family = isIP(ip);
  if (family === 4) return { ok: true, key: `v4:${ip}` };
  if (family !== 6) return { ok: false };

  const groups = ipv6Groups(ip);
  if (!groups) return { ok: false };
  const isMappedV4 =
    groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isMappedV4) {
    const [high = 0, low = 0] = groups.slice(6);
    return {
      ok: true,
      key: `v4:${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
    };
  }
  return {
    ok: true,
    key: `v6:${groups
      .slice(0, 4)
      .map((g) => g.toString(16))
      .join(':')}`,
  };
}
