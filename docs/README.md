# Planning mirrors

The [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55) is the planning tracker. ADR and phase documents here mirror its Phase 0 decisions and exit criteria. Update both when a decision changes. ADR-046 records the owner's one-time instruction to initialize the skeleton on the current repository's `main` branch. ADR-047 records the Phase 1 decision to share the owner's existing AWS account with enforced isolation.

## Operations

- [Toolchain and compatibility matrix](operations/toolchain.md): pinned Node, TypeScript, Vitest, and Angular versions with evidence (P1-03, R-07).
- [Initial abuse budgets](operations/abuse-budgets.md): provisional request limits, quotas, reservation semantics, and fail-closed rules (P1-13).
- [AWS and GitHub access](operations/access.md): audit findings, MFA-gated operator role setup, and the deployment-gate limitation (P1-02).
