# Phase 2: UI

Status: In progress

Branch: `phase/2-ui`

## Goal

Make the card and chat usable with mock streaming.

## Deliverables

Angular layout, ChatFacade, responsive states, Vitest, mocked-app Playwright smoke.

## Exit criteria

Usable mobile and desktop UI with a mock backend.

## Tasks

Acceptance criteria and owners live in the [Tasks database](https://app.notion.com/p/71e03c7833164fd282ad6c0e23b49d1d).

| ID                                                                 | Task                                                          | Priority | Area | Depends on          |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | -------- | ---- | ------------------- |
| [P2-01](https://app.notion.com/p/3efc9c3293d981d28ae2fcf6893a43e1) | Scaffold Angular SPA with composition root and boundaries     | P0       | web  | Phase 1 complete    |
| [P2-02](https://app.notion.com/p/3efc9c3293d98159a7bfec291e93c228) | Define visual direction, content slots, and responsive layout | P1       | web  | P2-01               |
| [P2-03](https://app.notion.com/p/3efc9c3293d9819f8a40c90b90392956) | Build presentation-card components                            | P1       | web  | P2-02               |
| [P2-04](https://app.notion.com/p/3efc9c3293d981e5afb3cee210aee625) | Define chat view models and ChatFacade signals                | P0       | web  | P2-01               |
| [P2-05](https://app.notion.com/p/3efc9c3293d981e2a212d550b5e70e7b) | Implement deterministic mock stream transport                 | P1       | web  | P2-04               |
| [P2-06](https://app.notion.com/p/3efc9c3293d981baa8d5ed2f9d2410f3) | Build composer, conversation, and citation placeholders       | P1       | web  | P2-02, P2-04, P2-05 |
| [P2-07](https://app.notion.com/p/3efc9c3293d9815b8852e638a40a0b90) | Add accessible responsive/error/empty states                  | P1       | web  | P2-03, P2-06        |
| [P2-08](https://app.notion.com/p/3efc9c3293d981bcb8a9ebcca0669449) | Add meaningful Vitest coverage                                | P1       | web  | P2-04, P2-05, P2-06 |
| [P2-09](https://app.notion.com/p/3efc9c3293d9813092eff21909ea49e7) | Add Playwright smoke on mocked application                    | P0       | web  | P2-07, P2-08        |
| [P2-10](https://app.notion.com/p/3efc9c3293d981c388d8d7a0f4282bbf) | Complete Phase 2 PR and usability evidence                    | P1       | docs | P2-09               |

## Risks and spikes

Mitigations and evidence live in [Spikes and Risks](https://app.notion.com/p/9f15a87a4832454c8f7609a834dab11a).

- [R-07](https://app.notion.com/p/3efc9c3293d981659e92c0b6d9c5928c) — Angular/Vitest integration (Spike, Medium)
- [R-10](https://app.notion.com/p/3efc9c3293d9818a9d0fc207f12d3107) — Production-only blast radius (Risk, Critical)
- [R-17](https://app.notion.com/p/3efc9c3293d981588adce3893bbcdd7a) — Public knowledge, XSS, and log leakage (Risk, High)

## Exit checklist

- [ ] Exit criteria above met
- [ ] Lint, typecheck, formatting, and Vitest green in CI
- [ ] Terraform fmt/validate/plan and Checkov green, or explicitly not applicable
- [ ] Phase-specific acceptance, cost, and security checks recorded
- [ ] Post-deploy smoke passed, or "endpoint smoke not applicable" recorded
- [ ] No secrets, private contact details, or confidential knowledge committed
- [ ] ADR and risk changes mirrored in Notion and `docs/`
- [ ] PR merged into `dev`, tagged `phase-2-complete`, Notion phase set to Done

## Evidence

- PR:
- Tag: `phase-2-complete`
- CI run:
- Deployment/smoke:
- Sign-off:

Sign-off and detailed results are tracked in the [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55).
