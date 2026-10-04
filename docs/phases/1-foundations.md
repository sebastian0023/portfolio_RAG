# Phase 1: Foundations

Status: Not started

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

- [ ] Exit criteria above met
- [ ] Lint, typecheck, formatting, and Vitest green in CI
- [ ] Terraform fmt/validate/plan and Checkov green, or explicitly not applicable
- [ ] Phase-specific acceptance, cost, and security checks recorded
- [ ] Post-deploy smoke passed, or "endpoint smoke not applicable" recorded
- [ ] No secrets, private contact details, or confidential knowledge committed
- [ ] ADR and risk changes mirrored in Notion and `docs/`
- [ ] PR merged into `dev`, tagged `phase-1-complete`, Notion phase set to Done

## Evidence

- PR:
- Tag: `phase-1-complete`
- CI run:
- Deployment/smoke:
- Sign-off:

Sign-off and detailed results are tracked in the [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55).
