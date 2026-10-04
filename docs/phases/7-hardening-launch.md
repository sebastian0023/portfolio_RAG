# Phase 7: Hardening and launch

Status: Not started

Branch: `phase/7-hardening-launch`

## Goal

Complete security, operations, content, and release.

## Deliverables

Alarms, WAF decision, IAM/CSP/HSTS/dependency review, runbook, domain, polish, final release PR.

## Exit criteria

v1.0.0.

## Tasks

Acceptance criteria and owners live in the [Tasks database](https://app.notion.com/p/71e03c7833164fd282ad6c0e23b49d1d).

| ID                                                                 | Task                                                 | Priority | Area     | Depends on          |
| ------------------------------------------------------------------ | ---------------------------------------------------- | -------- | -------- | ------------------- |
| [P7-01](https://app.notion.com/p/3efc9c3293d981d79e58c3b35f6ce2c1) | Complete metadata dashboards and actionable alarms   | P1       | infra    | Phase 6 complete    |
| [P7-02](https://app.notion.com/p/3efc9c3293d9819aae10ed7c4e24f5d7) | Revisit WAF with measured abuse and cost evidence    | P1       | security | P7-01               |
| [P7-03](https://app.notion.com/p/3efc9c3293d981b1b14afd8170f00532) | Run security and dependency review                   | P0       | security | P7-01               |
| [P7-04](https://app.notion.com/p/3efc9c3293d98138a72ec06e0f39721d) | Rehearse runbooks and protected-resource recovery    | P0       | docs     | P7-03               |
| [P7-05](https://app.notion.com/p/3efc9c3293d981f8a60bf0d33f0df877) | Configure domain and finalize public content/UI      | P1       | web      | P7-03               |
| [P7-06](https://app.notion.com/p/3efc9c3293d981b5815ad00a59ab7037) | Complete Phase 7 PR into dev and release checklist   | P0       | docs     | P7-02, P7-04, P7-05 |
| [P7-07](https://app.notion.com/p/3efc9c3293d98104af1edb5d3ecf3b31) | Release dev to main, tag v1.0.0, and switch delivery | P0       | infra    | P7-06               |

## Risks and spikes

Mitigations and evidence live in [Spikes and Risks](https://app.notion.com/p/9f15a87a4832454c8f7609a834dab11a).

- [R-08](https://app.notion.com/p/3efc9c3293d981c9a2bac7ac1e68fdd9) — Token and request-cost abuse (Risk, Critical)
- [R-10](https://app.notion.com/p/3efc9c3293d9818a9d0fc207f12d3107) — Production-only blast radius (Risk, Critical)
- [R-17](https://app.notion.com/p/3efc9c3293d981588adce3893bbcdd7a) — Public knowledge, XSS, and log leakage (Risk, High)
- [R-18](https://app.notion.com/p/3efc9c3293d981a7b47ce16e48765e34) — Secret values and rollback state leak through Terraform (Risk, High)

## Exit checklist

- [ ] Exit criteria above met
- [ ] Lint, typecheck, formatting, and Vitest green in CI
- [ ] Terraform fmt/validate/plan and Checkov green, or explicitly not applicable
- [ ] Phase-specific acceptance, cost, and security checks recorded
- [ ] Post-deploy smoke passed, or "endpoint smoke not applicable" recorded
- [ ] No secrets, private contact details, or confidential knowledge committed
- [ ] ADR and risk changes mirrored in Notion and `docs/`
- [ ] PR merged into `dev`, tagged `phase-7-complete`, Notion phase set to Done

## Evidence

- PR:
- Tag: `phase-7-complete`
- CI run:
- Deployment/smoke:
- Sign-off:

Sign-off and detailed results are tracked in the [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55).
