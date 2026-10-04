# Planning mirrors

The [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55) is the planning tracker. ADR and phase documents here mirror its Phase 0 decisions and exit criteria. Update both when a decision changes. ADR-046 records the owner's one-time instruction to initialize the skeleton on the current repository's `main` branch. ADR-047 records the Phase 1 decision to share the owner's existing AWS account with enforced isolation. ADR-048 records the Phase 2 decision to send a bounded public excerpt with each citation and to share one stream contract between the mock and the API. ADR-049 records the Phase 3 HTTP wire format and status table.

## Operations

- [Toolchain and compatibility matrix](operations/toolchain.md): pinned Node, TypeScript, Vitest, and Angular versions with evidence (P1-03, R-07).
- [Initial abuse budgets](operations/abuse-budgets.md): provisional request limits, quotas, reservation semantics, and fail-closed rules (P1-13).
- [AWS and GitHub access](operations/access.md): audit findings, MFA-gated operator role setup, and the deployment-gate limitation (P1-02).
- [Budget kill switch](operations/kill-switch.md): design, drill results with timings, caveats, and recovery steps (P1-08, P1-09).
- [Model and vector-store verification](operations/model-probe.md): probe results, the Haiku blocker, S3 Vectors limits, and shared quotas (P1-01).
- [Applying infrastructure](operations/apply-procedure.md): the manual, serialized apply procedure and why CI apply is disabled (P1-12).
- [CloudFront OAC streaming spike](operations/oac-spike.md): what was built, the 14-case result, and the findings that change the design (P1-10, R-04).
- [Spike and verification outcomes](operations/spike-outcomes.md): documented support versus proven in the account, with the gate for each open item (P1-14).
