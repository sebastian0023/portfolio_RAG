# Toolchain and compatibility matrix

Covers P1-03 and spike R-07 (Angular/Vitest integration). Pins live in the root `package.json`; `.npmrc` sets `engine-strict=true` so an unsupported Node or npm fails at `npm ci`.

## Pinned versions

| Component  | Pin              | Why it is allowed                                                                             |
| ---------- | ---------------- | --------------------------------------------------------------------------------------------- |
| Node       | `>=26.0.0 <27`   | `@angular/cli` 22.2.1 engines: `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0`                         |
| npm        | `>=11 <12`       | Matches `packageManager` (`npm@11.19.1`)                                                      |
| TypeScript | `6.0.3` (exact)  | `@angular/build` 22.2.1 peer: `>=6.0 <6.1`                                                    |
| Vitest     | `5.0.3` (exact)  | `@angular/build` 22.2.1 peer: `^4.0.8 \|\| ^5.0.0`                                            |
| Angular    | `22.2.1` (exact) | Installed by P2-01 in `apps/web`; `@angular/cdk` and `@angular/build` match                   |
| esbuild    | `0.28.2` (exact) | Direct devDependency of `apps/api`; bundles the Lambda. Same version Angular already resolves |

## Evidence (2026-10-04)

A throwaway app created with `npx @angular/cli@22.2.1 new --ssr=false` in a scratch directory, on Node 26.8.2 and npm 11.19.1, resolved `@angular/core@22.2.1`, `typescript@6.0.3`, and `vitest@5.0.3`. `ng test --watch=false` built the app and passed (2 tests); a separate production `ng build` was not run. The workspace therefore pins exactly the versions Angular's own scaffold resolved. The scratch app was not committed.

## Rules

- Move TypeScript only within the range Angular's build declares. Check `npm view @angular/build peerDependencies` before bumping it.
- Keep one Vitest version across the workspace so the Angular builder and the root `vitest run` projects agree.
- `apps/web` runs its tests with Angular's `@angular/build:unit-test` builder (Vitest runner, jsdom). It is not a root Vitest project. The root `npm test` runs `vitest run` for the other projects and then `ng test --watch=false`, so one command covers the Angular component tests and the backend, shared, and architecture tests (R-07).
- `apps/web` is not part of `tsc -b`. Its templates are type-checked by `ng build` (`strictTemplates`), which `npm run typecheck` runs after `tsc`.

## Install scripts

`npm ci` warns that `fsevents`, `unrs-resolver`, `esbuild`, `lmdb`, `msgpackr-extract`, and `@parcel/watcher` have install scripts not covered by `allowScripts`. Tests, lint, typecheck, and `ng build` pass without them (verified in P2-01), so they stay unapproved until something needs them. Revisit if a native build step is added.

## Architecture guard

`tests/architecture/boundaries.test.ts` builds a sandbox tree and runs the real `eslint.config.mjs` over it. It asserts that these fail: core to adapters, shared to web or api, web to api, api to web, and any AWS, Smithy, `aws-jwt-verify`, Anthropic, or OpenAI SDK import in `apps/api/src/core` or `packages/shared`. It also asserts that core to shared, web to shared, and adapter to core plus SDK stay allowed. With both rules switched off, seven of its eleven tests fail; the other four cover the allowed directions and the harness itself.

## Dependency audit (2026-10-04)

`npm audit --omit=dev` reports 0 vulnerabilities. `npm audit` reports 4 high-severity findings, all in one development-only chain: `braces` (stack exhaustion on deeply nested glob patterns, GHSA-vfj7-8cjw-p6xm) reached through `micromatch`, `@boundaries/elements`, and `eslint-plugin-boundaries`. The suggested `npm audit fix --force` installs `eslint-plugin-boundaries@1.1.1`, a breaking downgrade that would invalidate the v7 policy syntax used here, so it is **not** applied.

Accepted for now: the code only runs at lint time on this repository's own file paths, never on request data or in a deployed artifact. P1-11 adds `npm audit --omit=dev --audit-level=high` as a CI gate; P7-03 re-evaluates the development chain and the plugin choice.

## Lambda runtime and API bundle (Phase 3)

- **Runtime `nodejs24.x`.** It is generally available and supported until 2028-04-30. `nodejs26.x` is a public preview (not for production, no SLA) with general availability expected in November 2026, so the repository stays on Node 26 locally and in CI while the function runs on Node 24. The bundle targets `node24`, uses only standard Node APIs (`AbortSignal.any` and `AbortSignal.timeout` exist in Node 24), and carries its own AWS SDK, so the runtime's bundled SDK version is irrelevant. Moving to `nodejs26.x` is a Phase 7 task once it is generally available.
- **esbuild needs no install-script approval.** It runs from its platform binary package, which is already installed for Angular's build; the unapproved `install` script is only an optimization. The bundle test (`tests/build/api-bundle.test.ts`) proves two builds are byte-identical, which is what makes a CI plan and an operator plan agree.
- **Production dependencies of the API**, all exact and shared at one AWS SDK version: `hono`, `@aws-sdk/client-ssm`, `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-dynamodb`, and `zod`. `npm audit --omit=dev` reports 0 vulnerabilities. The bundle is about 1.8 MB, under the 3 MB test budget.
- **Zod under a strict CSP.** Zod 4 probes `new Function` to decide whether to compile validators, and a CSP without `unsafe-eval` reports that probe as a violation even though the error is caught. The shared browser schema module sets `z.config({ jitless: true })`; the production Playwright project fails on any CSP violation.
- **Web bundle budget.** Validating events in the browser adds Zod to the initial bundle, which is now about 690 kB raw (about 140 kB transferred, the earlier 243 kB raw plus the validator). The warning threshold moved from 500 kB to 750 kB; the 1 MB error threshold is unchanged.
