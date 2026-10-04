# Portfolio v2

An AWS serverless portfolio planned around an Angular presentation card and a cited, retrieval-augmented chat. The Phase 2 UI runs locally with a deterministic mock backend. The real API and deployment belong to later phases.

The [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55) tracks eight phases, tasks, decisions, risks, and exit evidence. ADR and phase mirrors are in `docs/`.

## Workspace

`apps/web` holds the Angular SPA; `apps/api` will hold the Lambda API; `packages/shared` holds framework-free ports and types. `infra/` contains Terraform foundations, `knowledge/` is reserved for reviewed public RAG material, and `evals/` holds model and security evaluations.

## Local checks

Use Node 26 and npm 11. Run `npm ci`, then `npm run check` for lint, typecheck, formatting, and Vitest. Start the mocked app with `npm run start -w @portfolio/web`, or run desktop and mobile browser smoke with `npm run test:e2e -w @portfolio/web` after installing Chromium with `npx playwright install chromium`. Development URLs accept `?scenario=answered` and `?mock=hang` for deterministic states; the production build ignores them. CI also runs Terraform `fmt` and `validate`, a module allowlist, Checkov, and a read-only plan.

## Git workflow

At the owner's request, the skeleton is initialized directly on this existing repository's `main` branch. This one-time Phase 0 exception supersedes the plan for a separate private repository and Phase 0 PR. Subsequent work uses `dev` as integration/deploy branch, phase branches and PRs into `dev`, Conventional Commits, and a final `dev` → `main` release PR in Phase 7. No deployment occurs in Phase 0.

The existing GitHub remote was public when Phase 0 began. The plan calls for private visibility during development. Verify visibility and branch protections before publishing non-skeleton content or enabling deployment. Never commit secrets, private contact details, or confidential knowledge.
