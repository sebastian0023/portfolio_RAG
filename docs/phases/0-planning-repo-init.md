# Phase 0: Planning + repo init

Status: In progress

Branch: `main` (owner-approved initialization exception)

## Goal

Agree on plan, then initialize reviewable skeleton.

## Deliverables

Notion plan; repository skeleton, tooling, shared contracts, docs, CI on existing main.

## Exit criteria

Plan approved; skeleton passes local checks and is committed on main; no application implementation or AWS resources. Remote visibility and branch protections verified before publishing non-skeleton work.

## Tasks

Acceptance criteria and owners live in the [Tasks database](https://app.notion.com/p/71e03c7833164fd282ad6c0e23b49d1d).

| ID                                                                 | Task                                                | Priority | Area  | Depends on            |
| ------------------------------------------------------------------ | --------------------------------------------------- | -------- | ----- | --------------------- |
| [P0-01](https://app.notion.com/p/3efc9c3293d981aaa416d6c69db7feb7) | Prepare Notion plan or full Markdown fallback       | P0       | docs  | —                     |
| [P0-02](https://app.notion.com/p/3efc9c3293d98132aca6fe21496d5e02) | Initialize private repo and scaffold after approval | P0       | infra | P0-01 + user approval |
| [P0-03](https://app.notion.com/p/3efc9c3293d981059ff0cb538dec69f9) | Validate and open Phase 0 PR                        | P1       | docs  | P0-02                 |

P0-02 and P0-03 originally called for a separate private `portfolio-v2` repository and a Phase 0 PR into `dev`. ADR-046 records the owner-approved exception: the skeleton is committed directly on this repository's `main`.

## Risks and spikes

Mitigations and evidence live in [Spikes and Risks](https://app.notion.com/p/9f15a87a4832454c8f7609a834dab11a).

- [R-13](https://app.notion.com/p/3efc9c3293d98111ab2cded8af732a5e) — Private GitHub repo cannot necessarily enforce required approval (Risk, Critical)

## Exit checklist

- [x] Notion plan prepared (P0-01)
- [x] Owner approved initializing the skeleton on the existing `main` (ADR-046 exception)
- [x] `npm ci` and `npm run check` pass locally
- [x] Skeleton committed on `main`; no application implementation or AWS resources
- [x] No secrets, private contact details, or confidential knowledge committed
- [ ] Remote visibility and branch protections verified, and actual platform limitations recorded (R-13)
- [ ] `dev` created from the skeleton commit and set as the default branch
- [ ] Notion phase and task statuses updated

## Evidence

- Commit:
- CI run: not applicable (PR checks run on PRs into `dev`)
- Deployment/smoke: not applicable (no AWS resources in Phase 0)
- Protections and visibility:
- Sign-off:

Sign-off and detailed results are tracked in the [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55).
