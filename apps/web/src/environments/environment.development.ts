// Dev and e2e build: ?scenario=<id> seeds the mocks, and owner placeholders show Pending markers.
export const environment = {
  production: false,
  scenarioHarness: true,
  showPendingMarkers: true,
} as const;
