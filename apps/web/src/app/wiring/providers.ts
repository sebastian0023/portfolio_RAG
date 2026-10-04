// The build default. The development configuration swaps this file for providers.development.ts through
// fileReplacements in angular.json, so the mock backend never reaches the production bundle.
export { createProviders } from './production-providers';
