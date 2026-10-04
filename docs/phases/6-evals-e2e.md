# Phase 6: Evals + e2e

Status: Not started

Branch: `phase/6-evals-e2e`

## Goal

Select the cheapest qualifying model using repeatable evidence.

## Deliverables

40–60 golden questions, retrieval/faithfulness/refusal/adversarial/cost suites, Gemma adapter, policy.yaml, CI gates, local e2e, post-deploy smoke.

## Exit criteria

Documented model choice with a results table.

## Tasks

Acceptance criteria and owners live in the [Tasks database](https://app.notion.com/p/71e03c7833164fd282ad6c0e23b49d1d).

| ID                                                                 | Task                                                 | Priority | Area  | Depends on          |
| ------------------------------------------------------------------ | ---------------------------------------------------- | -------- | ----- | ------------------- |
| [P6-01](https://app.notion.com/p/3efc9c3293d98145af6af1f39e6cdc59) | Build versioned golden and adversarial datasets      | P0       | evals | Phase 5 complete    |
| [P6-02](https://app.notion.com/p/3efc9c3293d9818f9571f1de49820cec) | Implement retrieval and answer-quality scoring       | P1       | evals | P6-01               |
| [P6-03](https://app.notion.com/p/3efc9c3293d98159a302dd8051405cba) | Implement Gemma mantle adapter and contract parity   | P0       | api   | P6-01, P1-01        |
| [P6-04](https://app.notion.com/p/3efc9c3293d981839120eaaea701f67d) | Compare models and apply policy.yaml selection       | P0       | evals | P6-02, P6-03        |
| [P6-05](https://app.notion.com/p/3efc9c3293d981b08a1df85ccb2c7ca9) | Add selective full-suite and every-push smoke gates  | P0       | infra | P6-04               |
| [P6-06](https://app.notion.com/p/3efc9c3293d9810fafdafa6665818f54) | Add local-stack Playwright and tiny deployment smoke | P0       | evals | P6-03               |
| [P6-07](https://app.notion.com/p/3efc9c3293d98148ba3dcb1a1536bbf6) | Publish results table and complete Phase 6           | P1       | docs  | P6-04, P6-05, P6-06 |

## Risks and spikes

Mitigations and evidence live in [Spikes and Risks](https://app.notion.com/p/9f15a87a4832454c8f7609a834dab11a).

- [R-01](https://app.notion.com/p/3efc9c3293d9813bba50eff556050ab0) — Bedrock availability, IDs, region, pricing (Spike, High)
- [R-03](https://app.notion.com/p/3efc9c3293d981eca33fef4895694ea9) — Endpoint IAM differences and incomplete kill policy (Spike, Critical)
- [R-08](https://app.notion.com/p/3efc9c3293d981c9a2bac7ac1e68fdd9) — Token and request-cost abuse (Risk, Critical)
- [R-09](https://app.notion.com/p/3efc9c3293d9813da5c6e1140a25bde3) — Prompt injection and unsupported claims (Risk, High)
- [R-10](https://app.notion.com/p/3efc9c3293d9818a9d0fc207f12d3107) — Production-only blast radius (Risk, Critical)
- [R-12](https://app.notion.com/p/3efc9c3293d981d5bd94ca8d2f168954) — Gemma protocol, state, reasoning, and usage differences (Risk, High)
- [R-14](https://app.notion.com/p/3efc9c3293d981d5b922fd787510cbe9) — CI and evals become a second abuse path (Risk, High)

## Exit checklist

- [ ] Exit criteria above met
- [ ] Lint, typecheck, formatting, and Vitest green in CI
- [ ] Terraform fmt/validate/plan and Checkov green, or explicitly not applicable
- [ ] Phase-specific acceptance, cost, and security checks recorded
- [ ] Post-deploy smoke passed, or "endpoint smoke not applicable" recorded
- [ ] No secrets, private contact details, or confidential knowledge committed
- [ ] ADR and risk changes mirrored in Notion and `docs/`
- [ ] PR merged into `dev`, tagged `phase-6-complete`, Notion phase set to Done

## Evidence

- PR:
- Tag: `phase-6-complete`
- CI run:
- Deployment/smoke:
- Sign-off:

Sign-off and detailed results are tracked in the [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55).
