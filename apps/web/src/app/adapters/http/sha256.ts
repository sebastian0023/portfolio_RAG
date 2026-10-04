// CloudFront signs the request body for the OAC origin, so the browser must send the SHA-256 of the exact
// bytes it posts as x-amz-content-sha256. A missing or wrong value gets a 403 at the edge (ADR-049).
export async function sha256Hex(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
