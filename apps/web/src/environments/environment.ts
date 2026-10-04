// Production build: the scenario harness and Pending markers are off.
export const environment = {
  production: true,
  scenarioHarness: false,
  showPendingMarkers: false,
  // The public Cloudflare Turnstile sitekey for this site (ADR-052). It is public by design and is not a
  // secret. Set it to the sitekey of the widget created in the Cloudflare dashboard; deploy-web.ts refuses to
  // publish a build while it is empty.
  turnstileSiteKey: '',
} as const;
