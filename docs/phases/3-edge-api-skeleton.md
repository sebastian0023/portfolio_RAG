# Phase 3: Edge + API skeleton

Status: Not started

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

## Exit checklist

- [ ] Exit criteria above met
- [ ] Lint, typecheck, formatting, and Vitest green in CI
- [ ] Terraform fmt/validate/plan and Checkov green, or explicitly not applicable
- [ ] Phase-specific acceptance, cost, and security checks recorded
- [ ] Post-deploy smoke passed, or "endpoint smoke not applicable" recorded
- [ ] No secrets, private contact details, or confidential knowledge committed
- [ ] ADR and risk changes mirrored in Notion and `docs/`
- [ ] PR merged into `dev`, tagged `phase-3-complete`, Notion phase set to Done

## Evidence

- PR:
- Tag: `phase-3-complete`
- CI run:
- Deployment/smoke:
- Sign-off:

Sign-off and detailed results are tracked in the [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55).
