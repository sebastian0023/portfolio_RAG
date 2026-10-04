// Dev and e2e build: ?scenario=<id> seeds the mocks, and owner placeholders show Pending markers.
export const environment = {
  production: false,
  scenarioHarness: true,
  showPendingMarkers: true,
  // Cloudflare's published always-passes invisible test key. The mock guest check does not use it; it is
  // here so a dev build that is switched to the real adapter works without a Cloudflare account.
  turnstileSiteKey: '1x00000000000000000000BB',
} as const;
