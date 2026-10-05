// Bundles the operator CLIs into apps/api/dist/cli. Run with: npm run build:cli -w @portfolio/api
import { buildCliBundles } from './build.ts';

for (const file of await buildCliBundles()) process.stdout.write(`${file}\n`);
