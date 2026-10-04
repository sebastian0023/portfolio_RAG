# Phase 4: Auth and abuse protection

Status: Not started

Branch: `phase/4-auth-abuse-protection`

## Goal

Safely enable anonymous and authenticated traffic.

## Deliverables

Cognito, JWT, Turnstile, quotas, admin MFA/authorization, endpoints, chat flag.

## Exit criteria

Guest and signed-in flows tested; cost-abuse tests pass.

## Tasks

Acceptance criteria and owners live in the [Tasks database](https://app.notion.com/p/71e03c7833164fd282ad6c0e23b49d1d).

| ID                                                                 | Task                                                   | Priority | Area     | Depends on             |
| ------------------------------------------------------------------ | ------------------------------------------------------ | -------- | -------- | ---------------------- |
| [P4-01](https://app.notion.com/p/3efc9c3293d9815ca813ccb9d8d5e658) | Provision protected Cognito pool and social app client | P0       | infra    | Phase 3 complete       |
| [P4-02](https://app.notion.com/p/3efc9c3293d981618936c73a5a6c539f) | Implement SPA auth and strict JWT middleware           | P0       | api      | P4-01                  |
| [P4-03](https://app.notion.com/p/3efc9c3293d981c09a83d1de9960efdf) | Add Turnstile server verification and guest UX         | P0       | security | P4-02                  |
| [P4-04](https://app.notion.com/p/3efc9c3293d981b4b74ad22f9c6c7498) | Implement atomic guest/user/global quotas              | P0       | security | P4-02, P4-03           |
| [P4-05](https://app.notion.com/p/3efc9c3293d981bda3f6fd654d915f14) | Implement admin authorization with enforced MFA        | P0       | security | P4-01, R-11 resolution |
| [P4-06](https://app.notion.com/p/3efc9c3293d981058c89e0e6ae8f957c) | Wire chat_enabled and cost-abuse failure cases         | P0       | api      | P4-04                  |
| [P4-07](https://app.notion.com/p/3efc9c3293d9812a88d7d2656167b59a) | Complete auth journeys and abuse-gate phase PR         | P0       | evals    | P4-05, P4-06           |

## Risks and spikes

Mitigations and evidence live in [Spikes and Risks](https://app.notion.com/p/9f15a87a4832454c8f7609a834dab11a).

- [R-05](https://app.notion.com/p/3efc9c3293d98124ac2ce500464889e6) — Cognito price/feature plan (Spike, High)
- [R-08](https://app.notion.com/p/3efc9c3293d981c9a2bac7ac1e68fdd9) — Token and request-cost abuse (Risk, Critical)
- [R-10](https://app.notion.com/p/3efc9c3293d9818a9d0fc207f12d3107) — Production-only blast radius (Risk, Critical)
- [R-11](https://app.notion.com/p/3efc9c3293d98142a92becef47a2a47a) — Social-only admin MFA is not supplied by a group (Risk, Critical)
- [R-15](https://app.notion.com/p/3efc9c3293d9818b871ac491e12e77ef) — Counter identity spoofing, TTL delay, and races (Risk, High)
- [R-18](https://app.notion.com/p/3efc9c3293d981a7b47ce16e48765e34) — Secret values and rollback state leak through Terraform (Risk, High)

## Exit checklist

- [ ] Exit criteria above met
- [ ] Lint, typecheck, formatting, and Vitest green in CI
- [ ] Terraform fmt/validate/plan and Checkov green, or explicitly not applicable
- [ ] Phase-specific acceptance, cost, and security checks recorded
- [ ] Post-deploy smoke passed, or "endpoint smoke not applicable" recorded
- [ ] No secrets, private contact details, or confidential knowledge committed
- [ ] ADR and risk changes mirrored in Notion and `docs/`
- [ ] PR merged into `dev`, tagged `phase-4-complete`, Notion phase set to Done

## Evidence

- PR:
- Tag: `phase-4-complete`
- CI run:
- Deployment/smoke:
- Sign-off:

Sign-off and detailed results are tracked in the [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55).
