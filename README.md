# Portfolio v2

An AWS serverless portfolio planned around an Angular presentation card and a cited, retrieval-augmented chat. This is a **Phase 0 skeleton** with tooling, shared contracts, CI, and planning documents; no app implementation or AWS resources exist yet.

The [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55) tracks eight phases, tasks, decisions, risks, and exit evidence. ADR and phase mirrors are in `docs/`.

## Workspace

`apps/web` will hold the Angular SPA; `apps/api` the Lambda API; `packages/shared` the framework-free ports and types. `infra/` is reserved for Terraform, `knowledge/` for reviewed public RAG source material, and `evals/` for model and security evaluations.

## Local checks

Use Node 26 and npm 11. Run `npm ci`, then `npm run check` for lint, typecheck, formatting, and Vitest. `npm run test` runs one placeholder test in each workspace. CI also runs Terraform `fmt` and `validate`, a module allowlist, and Checkov over `infra/`. A read-only `plan` job joins once the CI plan role exists (Phase 1).

## Git workflow

At the owner's request, the skeleton is initialized directly on this existing repository's `main` branch. This one-time Phase 0 exception supersedes the plan for a separate private repository and Phase 0 PR. Subsequent work uses `dev` as integration/deploy branch, phase branches and PRs into `dev`, Conventional Commits, and a final `dev` → `main` release PR in Phase 7. No deployment occurs in Phase 0.

The existing GitHub remote was public when Phase 0 began. The plan calls for private visibility during development. Verify visibility and branch protections before publishing non-skeleton content or enabling deployment. Never commit secrets, private contact details, or confidential knowledge.
