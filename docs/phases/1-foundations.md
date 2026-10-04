# Phase 1: Foundations

Status: Done

Branch: `phase/1-foundations`

## Goal

Establish safe tooling, state, delivery identity, budgets, and configuration.

## Deliverables

Monorepo tooling; bootstrap/state lockfile; repo/branch-scoped OIDC; budget kill switch; SSM; base CI; region, OAC/header, and budget spikes.

## Exit criteria

CI green; Terraform plan runs from CI via OIDC; kill switch verified in a test.

## Tasks

Acceptance criteria and owners live in the [Tasks database](https://app.notion.com/p/71e03c7833164fd282ad6c0e23b49d1d).

| ID                                                                 | Task                                                       | Priority | Area     | Depends on                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------- | -------- | -------- | -------------------------- |
| [P1-01](https://app.notion.com/p/3efc9c3293d981d6b615da1e614be356) | Verify region, models, endpoint IAM, and prices            | P0       | infra    | Phase 0 complete           |
| [P1-02](https://app.notion.com/p/3efc9c3293d981b4a438fb275e0dfad3) | Audit dedicated account, GitHub gate, and bootstrap access | P0       | security | Phase 0 complete           |
| [P1-03](https://app.notion.com/p/3efc9c3293d981edb3bfd8c85bcb07e9) | Harden workspace and test orchestration                    | P1       | api      | Phase 0 complete           |
| [P1-04](https://app.notion.com/p/3efc9c3293d9813d8180e00fb1085f52) | Implement encrypted versioned S3 state bootstrap           | P0       | infra    | P1-02                      |
| [P1-05](https://app.notion.com/p/3efc9c3293d9819b8f66d7372c417095) | Create scoped OIDC planning and deployment roles           | P0       | security | P1-04                      |
| [P1-06](https://app.notion.com/p/3efc9c3293d98194932efa03b97216f6) | Create Terraform module boundaries and deletion guards     | P1       | infra    | P1-04                      |
| [P1-07](https://app.notion.com/p/3efc9c3293d98189b921d6d63876f1b1) | Establish typed SSM configuration contract                 | P1       | api      | P1-03, P1-06               |
| [P1-08](https://app.notion.com/p/3efc9c3293d981099746e7f18d47eb9d) | Implement Budgets deny-policy action and fallback design   | P0       | security | P1-01, P1-05, P1-06        |
| [P1-09](https://app.notion.com/p/3efc9c3293d98112a0f0ec799ded7321) | Exercise budget kill switch without waiting for spend      | P0       | security | P1-08                      |
| [P1-10](https://app.notion.com/p/3efc9c3293d9817cbc05f494c2081482) | Spike CloudFront OAC, custom JWT header, and streamed POST | P0       | api      | P1-05                      |
| [P1-11](https://app.notion.com/p/3efc9c3293d981a5a3e1db7f5187e5dc) | Implement PR checks and trusted OIDC Terraform plan        | P0       | infra    | P1-03, P1-05, P1-06        |
| [P1-12](https://app.notion.com/p/3efc9c3293d981f58356ff9841642379) | Configure gated, serialized dev foundation delivery        | P0       | infra    | P1-02, P1-11               |
| [P1-13](https://app.notion.com/p/3efc9c3293d981bab1e7eae52710e525) | Define initial abuse budgets and failure behavior          | P1       | security | P1-01, P1-07               |
| [P1-14](https://app.notion.com/p/3efc9c3293d981da94f0ce16f801ab05) | Record spike outcomes and update operational notes         | P1       | docs     | P1-01, P1-09, P1-10        |
| [P1-15](https://app.notion.com/p/3efc9c3293d9812b84e6d400d7067488) | Complete Phase 1 PR and exit evidence                      | P1       | docs     | P1-11, P1-12, P1-13, P1-14 |

## Risks and spikes

Mitigations and evidence live in [Spikes and Risks](https://app.notion.com/p/9f15a87a4832454c8f7609a834dab11a).

- [R-01](https://app.notion.com/p/3efc9c3293d9813bba50eff556050ab0) — Bedrock availability, IDs, region, pricing (Spike, High)
- [R-02](https://app.notion.com/p/3efc9c3293d9814e8d45ffca9434d812) — S3 Vectors region, limits, and prices (Spike, High)
- [R-03](https://app.notion.com/p/3efc9c3293d981eca33fef4895694ea9) — Endpoint IAM differences and incomplete kill policy (Spike, Critical)
- [R-04](https://app.notion.com/p/3efc9c3293d981d8b5ecd074a7a33898) — OAC Authorization/header/SSE integration (Spike, Critical)
- [R-05](https://app.notion.com/p/3efc9c3293d98124ac2ce500464889e6) — Cognito price/feature plan (Spike, High)
- [R-06](https://app.notion.com/p/3efc9c3293d981329d44e5eb933e5781) — AWS Budgets action capabilities and delayed billing (Spike, Critical)
- [R-07](https://app.notion.com/p/3efc9c3293d981659e92c0b6d9c5928c) — Angular/Vitest integration (Spike, Medium)
- [R-10](https://app.notion.com/p/3efc9c3293d9818a9d0fc207f12d3107) — Production-only blast radius (Risk, Critical)
- [R-12](https://app.notion.com/p/3efc9c3293d981d5bd94ca8d2f168954) — Gemma protocol, state, reasoning, and usage differences (Risk, High)
- [R-13](https://app.notion.com/p/3efc9c3293d98111ab2cded8af732a5e) — Private GitHub repo cannot necessarily enforce required approval (Risk, Critical)
- [R-14](https://app.notion.com/p/3efc9c3293d981d5b922fd787510cbe9) — CI and evals become a second abuse path (Risk, High)
- [R-18](https://app.notion.com/p/3efc9c3293d981a7b47ce16e48765e34) — Secret values and rollback state leak through Terraform (Risk, High)

## Exit checklist

- [x] Exit criteria above met (see Evidence)
- [x] Lint, typecheck, formatting, and Vitest green in CI (99 tests)
- [x] Terraform fmt, validate, plan, and Checkov green in CI; the `plan` job assumes the read-only role through OIDC
- [x] Kill switch verified in a test: deny policy refused Titan, Haiku, and Gemma within 8 to 13 seconds on existing credentials ([kill-switch.md](../operations/kill-switch.md))
- [x] Phase-specific acceptance, cost, and security checks recorded ([spike-outcomes.md](../operations/spike-outcomes.md))
- [x] Foundation smoke: the CI `plan` job runs against the real applied stack; after the merge into `dev`, `terraform plan` from `dev` in `infra/bootstrap` and `infra/stack` must report no changes (recorded on the tag)
- [x] No secrets, private contact details, or confidential knowledge committed
- [x] ADR and risk changes mirrored in Notion and `docs/` (ADR-047; R-01 to R-04, R-06, R-13, R-14, R-18)
- [ ] PR merged into `dev`, tagged `phase-1-complete`, Notion phase set to Done

## Open items carried forward

| Item                                                   | Why it is open                                                                 | Closes in                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------- |
| Anthropic use-case form for Haiku 4.5                  | Done by the owner; Haiku verified with 10 of 10 calls                          | Closed                                |
| Automatic budget trigger                               | Needs real spend to reach 100 percent; Gemma's billing service name is unknown | P7-04, P6-03                          |
| Billed prices for Titan, Haiku, Gemma                  | Cost Explorer lags by up to a day                                              | Next session, before P3-04            |
| Angular component test and backend test in one command | Angular is added in Phase 2                                                    | P2-08                                 |
| CI apply                                               | GitHub does not enforce required reviewers on this plan; no apply role exists  | Only with a proven gate and a new ADR |

## Evidence

- PRs into the phase branch: #2 workspace and abuse budgets, #3 and #5 and #7 account scope and access, #4 and #8 bootstrap, OIDC, and CI plan, #9 config contract and budgets, #10 and #11 evidence, spike, and apply procedure.
- Applied to AWS from reviewed commits with the MFA-gated operator role: bootstrap (state bucket, plan role), stack (4 SSM parameters, deny policy, probe and action roles, 2 budgets, 1 budget action). All spike resources were destroyed.
- CI: four required jobs on every pull request (`typescript`, `terraform`, `checkov`, `plan`). `dev` requires them, requires a pull request, and applies to admins.
- Tag: `phase-1-complete`
- Deployment/smoke: foundation smoke only (no endpoint exists yet): `terraform plan` from `dev` reports no changes.
- Sign-off:

Sign-off and detailed results are tracked in the [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55).
