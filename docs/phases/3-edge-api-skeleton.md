# Phase 3: Edge + API skeleton

Status: Complete (deployed and smoke-tested from `dev`). Notion mirror and the items listed under "Not recorded" remain.

Branch: `phase/3-edge-api-skeleton`

## Goal

Deliver a streaming plain-LLM request through the edge.

## Deliverables

CloudFront/private S3/OAC; Lambda SSE; LLMProvider + Haiku adapter; validation/rate middleware; header policy.

## Exit criteria

Deployed from dev; streaming chat works end to end with a plain LLM.

## Tasks

Acceptance criteria and owners live in the [Tasks database](https://app.notion.com/p/71e03c7833164fd282ad6c0e23b49d1d).

| ID                                                                 | Task                                                  | Priority | Area     | Depends on          |
| ------------------------------------------------------------------ | ----------------------------------------------------- | -------- | -------- | ------------------- |
| [P3-01](https://app.notion.com/p/3efc9c3293d981899fead8b13ba4d541) | Provision private web S3 and CloudFront behaviors     | P0       | infra    | Phase 2 complete    |
| [P3-02](https://app.notion.com/p/3efc9c3293d9815bafb7f15de33949f1) | Provision ARM64 Lambda streaming URL and live alias   | P0       | infra    | P3-01               |
| [P3-03](https://app.notion.com/p/3efc9c3293d981878c3bdc80d8eb0ce9) | Wire Hono composition root and SSE protocol           | P1       | api      | P3-02               |
| [P3-04](https://app.notion.com/p/3efc9c3293d981f6b78ccdc7d7e4fca4) | Implement LLMProvider registry and Haiku adapter      | P1       | api      | P3-03               |
| [P3-05](https://app.notion.com/p/3efc9c3293d981688bf3e5359af2dfeb) | Implement validation and pre-auth rate middleware     | P0       | security | P3-03               |
| [P3-06](https://app.notion.com/p/3efc9c3293d9817e8cbdecec6c6c32a5) | Connect Angular transport and edge header policy      | P1       | web      | P3-03, P3-04, P3-05 |
| [P3-07](https://app.notion.com/p/3efc9c3293d981bebcf4d90358e04954) | Deploy from dev and complete streaming phase evidence | P0       | docs     | P3-06               |

## Risks and spikes

Mitigations and evidence live in [Spikes and Risks](https://app.notion.com/p/9f15a87a4832454c8f7609a834dab11a).

- [R-01](https://app.notion.com/p/3efc9c3293d9813bba50eff556050ab0) — Bedrock availability, IDs, region, pricing (Spike, High)
- [R-04](https://app.notion.com/p/3efc9c3293d981d8b5ecd074a7a33898) — OAC Authorization/header/SSE integration (Spike, Critical)
- [R-08](https://app.notion.com/p/3efc9c3293d981c9a2bac7ac1e68fdd9) — Token and request-cost abuse (Risk, Critical)
- [R-10](https://app.notion.com/p/3efc9c3293d9818a9d0fc207f12d3107) — Production-only blast radius (Risk, Critical)
- [R-15](https://app.notion.com/p/3efc9c3293d9818b871ac491e12e77ef) — Counter identity spoofing, TTL delay, and races (Risk, High)

## What is built

| Task  | Result                                                                                                                                                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-01 | `web` and `edge` modules: private versioned bucket, OAC, CloudFront distribution, SPA and API security-header policies from one JSON file, no distribution-wide error mapping (ADR-013). Plan-role reads and plan-guard types added.                       |
| P3-02 | `storage` and `api` modules: counters table, `nodejs24.x` arm64 function with reserved concurrency 5, `live` alias, Function URL on the alias, scoped execution role, both CloudFront invoke permissions, kill-switch target. Reproducible esbuild bundle. |
| P3-03 | Hono routing, a Lambda streaming adapter that aborts on disconnect, SSM config source, metadata-only logger, one composition root (production-only). SSE wire format and status table in ADR-049.                                                          |
| P3-04 | Provider registry, Bedrock Converse adapter (zero retries, schema-checked stream, no raw errors), plain chat service, the ADR-045 contract suite run against the fake and the adapter.                                                                     |
| P3-05 | Trusted viewer address (IPv6 by /64), per-IP and global per-minute limits in one transaction, `chat_enabled` check, temporary daily cap (ADR-050), DynamoDB counter store with a shared contract suite.                                                    |
| P3-06 | HTTP transport (body hash, streaming parser, per-event schema validation), production wiring with no mocks, sign-in hidden until Phase 4, a CSP-clean production build proven by Playwright, `deploy-web.ts`.                                              |
| P3-07 | `smoke-edge.ts`, the "Deploying application code" runbook, kill-switch and spike notes. Deployment and evidence are owner-run (below).                                                                                                                     |

## Owner-run steps remaining

Each step follows [Applying infrastructure](../operations/apply-procedure.md) and needs the owner's explicit go-ahead.

1. Merge the task pull requests into `phase/3-edge-api-skeleton` in order. Apply `infra/bootstrap` after the first one: the CI plan role needs its new reads before any stack plan can pass.
2. Apply `infra/stack` (this creates the bucket, distribution, table, function, and alias, with `chat_enabled` still `false`). Expect one iteration if the plan role is missing a read.
3. Run `deploy-web.ts`, then `smoke-edge.ts` with chat off.
4. Open one bounded window (`chat_enabled` true), run `smoke-edge.ts --chat-only`, run the kill-switch drill, close the window.
5. Open the consolidated pull request into `dev`. After the merge, apply and deploy again from `dev`, rehearse the rollback, record the evidence below, tag `phase-3-complete`, and set the Notion phase to Done.

## Exit checklist

- [x] Exit criteria above met: deployed from `dev` (`b55f98b`), and a streamed plain-LLM answer works end to end through CloudFront (proven on the same code at `20c5255`; the bundle hash from `dev` is identical).
- [x] Lint, typecheck, formatting, and Vitest green locally (308 root tests, 163 Angular tests, 6 mocked and 14 production-build browser tests) and in CI on every Phase 3 pull request.
- [x] Terraform fmt, validate, plan, and the plan guard green in CI after the bootstrap apply; Checkov green (228 passed, 0 failed, 51 skipped, every skip justified).
- [ ] Phase-specific acceptance, cost, and security checks recorded. Smoke results are below; the kill-switch drill result and the cost after 24 hours are still to be recorded.
- [x] Post-deploy smoke passed from the phase branch (chat off: all checks; chat on: one streamed answer) and again from `dev` (chat off: all checks).
- [x] No secrets, private contact details, or confidential knowledge committed
- [ ] ADR and risk changes mirrored in Notion and `docs/` (ADR-049 and ADR-050 are in `docs/`; Notion mirror and R-01, R-04, R-08, R-10, R-15 updates pending)
- [x] PR merged into `dev` and tagged `phase-3-complete`
- [ ] Notion phase set to Done (owner)

## Evidence

- Task PRs into the phase branch: #19 to #26, plus smoke-script fixes #27 and #28. Each was green on `typescript`, `terraform`, `checkov`, `plan`, and `browser-smoke` before merging.
- PR into `dev`: [#30](https://github.com/sebastian0023/portfolio_RAG/pull/30), merged as `b55f98b`
- Tag: [`phase-3-complete`](https://github.com/sebastian0023/portfolio_RAG/tree/phase-3-complete) on `b55f98b`
- CI run: all five required jobs green on every Phase 3 pull request. #21 to #26 first failed `plan` only because the plan role lacked `bedrock:GetInferenceProfile`; it passed after the owner applied `infra/bootstrap`.
- Applied from reviewed commits with the MFA operator role: `infra/bootstrap` (plan-role reads), then `infra/stack` at `20c5255` (web bucket, distribution, counters table, API function and `live` alias, kill-switch target). A follow-up `terraform plan` reported no changes.
- Deployment: `deploy-web.ts` from `20c5255` published 44 files (about 1.0 MB) and invalidated `/index.html` and `/version.json`.
- Smoke, chat off (2026-10-04): the SPA and every security header from the shared policy; no inline script; `index.html` not cached and hashed assets immutable; `version.json` names the deployed commit; direct S3 object and unsigned Function URL refused (403); POST without a hash and with a wrong hash refused (403); unknown API path is a 404 SSE error, not HTML; `OPTIONS` is 405 with no CORS headers; 9 KB and 1 MB bodies are 413; a 501-character question is `too_long`; a wrong content type is 415; the first 10 requests in a minute are admitted and the 11th and 12th are rate limited with `Retry-After`; with chat off every admitted request is a 503. The first run of the older script failed two rate-limit checks because it sent 15 concurrent requests against reserved concurrency 5 (Lambda refused 10 with a bare 429); the script was fixed (#27) and a re-run passed everything.
- From `dev` (`b55f98b`): the API bundle hash matches the one CI built; `terraform plan` on `infra/stack` reports no changes and the plan guard no violations; `deploy-web.ts` published 44 files and invalidated `/index.html` and `/version.json`; the chat-off smoke passed every check, `version.json` names `b55f98b`, the first 10 requests in a window were admitted (503, chat off), the 11th and 12th were 429 with `Retry-After`, and 6 of 12 over-concurrency requests got Lambda's bare 429.
- Smoke, chat on (one bounded window, then `chat_enabled` set back to `false`): a 200 SSE stream; `accepted` first, deltas, `done` with no coverage; first byte and first delta at 1306 ms (cold start included) and the stream complete at 1418 ms for a one-sentence answer, so the stream shows as incremental only narrowly. The window was closed and verified (`chat_enabled` is `false`, the API role has no attached policies, and a request without the body hash is refused with 403).
- Not recorded yet: the kill-switch drill timing on the API role, the browser check of a streamed answer and Stop, the cost after 24 hours, and the rollback rehearsal.
- Security: no request bodies, tokens, or addresses are printed by the scripts; logs hold metadata only (redaction is unit-tested).
- Sign-off:

Sign-off and detailed results are tracked in the [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55).
