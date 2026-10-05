# Planning mirrors

The [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55) is the planning tracker. ADR and phase documents here mirror its Phase 0 decisions and exit criteria. Update both when a decision changes. ADR-046 records the owner's one-time instruction to initialize the skeleton on the current repository's `main` branch. ADR-047 records the Phase 1 decision to share the owner's existing AWS account with enforced isolation. ADR-048 records the Phase 2 decision to send a bounded public excerpt with each citation and to share one stream contract between the mock and the API. ADR-049 records the Phase 3 HTTP wire format and status table, and ADR-050 the Phase 3 cost guard (`chat_enabled`, a temporary daily cap, and a 40 per minute global limit). ADR-051 records the Phase 4 decision to have guests only (no Cognito, no accounts, 10 questions per IP and 50 per site per day), ADR-052 the Turnstile guest pass, ADR-053 the Phase 5 ingestion and index lifecycle, and ADR-054 the retrieval, prompt, abstention, and citation policy.

## Operations

- [Toolchain and compatibility matrix](operations/toolchain.md): pinned Node, TypeScript, Vitest, and Angular versions with evidence (P1-03, R-07).
- [Initial abuse budgets](operations/abuse-budgets.md): provisional request limits, quotas, reservation semantics, and fail-closed rules (P1-13).
- [AWS and GitHub access](operations/access.md): audit findings, MFA-gated operator role setup, and the deployment-gate limitation (P1-02).
- [Budget kill switch](operations/kill-switch.md): design, drill results with timings, caveats, and recovery steps (P1-08, P1-09).
- [Model and vector-store verification](operations/model-probe.md): probe results, the Haiku blocker, S3 Vectors limits, and shared quotas (P1-01).
- [Applying infrastructure](operations/apply-procedure.md): the manual, serialized apply procedure and why CI apply is disabled (P1-12).
- [CloudFront OAC streaming spike](operations/oac-spike.md): what was built, the 14-case result, and the findings that change the design (P1-10, R-04).
- [Finishing Phase 4](operations/phase-4-finish.md): the owner-only steps that remain (Turnstile widget, secrets, deploy, bounded chat window) and why.
- [Index lifecycle](operations/index-lifecycle.md): ingest, quality gate, promote, roll back, and prune retrieval indexes (P5-04, P5-07, R-16).
- [Finishing Phase 5](operations/phase-5-finish.md): the owner-only steps (corpus, applies, ingest, gate, promotion, rollback drill, chat window).
- [Spike and verification outcomes](operations/spike-outcomes.md): documented support versus proven in the account, with the gate for each open item (P1-14).
