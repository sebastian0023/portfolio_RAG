# Phase 5: RAG

Status: Code complete and merged to the phase branch (2026-10-05). Waiting on the owner: the knowledge corpus, the AWS applies, ingestion, promotion, and the chat window ([phase-5-finish.md](../operations/phase-5-finish.md)).

Branch: `phase/5-rag`

## Goal

Ground answers in an auditable public corpus.

## Deliverables

Knowledge markdown, chunk metadata, ingestion, blue/green S3 Vectors, IndexRepository, filtered retrieval, UI citations.

## Exit criteria

Grounded answers with citations in dev.

## Tasks

Acceptance criteria and owners live in the [Tasks database](https://app.notion.com/p/71e03c7833164fd282ad6c0e23b49d1d).

| ID                                                                 | Task                                                   | Priority | Area  | Depends on       |
| ------------------------------------------------------------------ | ------------------------------------------------------ | -------- | ----- | ---------------- |
| [P5-01](https://app.notion.com/p/3efc9c3293d981dc9f20ca0ce32fd397) | Author and review public knowledge markdown            | P0       | docs  | Phase 4 complete |
| [P5-02](https://app.notion.com/p/3efc9c3293d9816f8f0aee850e560d56) | Define chunker, metadata schema, and manifest hash     | P1       | api   | P5-01            |
| [P5-03](https://app.notion.com/p/3efc9c3293d981dba818fa9560850d89) | Implement IndexRepository fake and S3 Vectors adapter  | P1       | api   | P5-02            |
| [P5-04](https://app.notion.com/p/3efc9c3293d98190a6b9f6e0e750097b) | Build bounded Titan ingestion and candidate indexes    | P0       | infra | P5-03            |
| [P5-05](https://app.notion.com/p/3efc9c3293d9812ebca1da8e34af3b18) | Implement RagService template and PromptBuilder        | P1       | api   | P5-03, P5-04     |
| [P5-06](https://app.notion.com/p/3efc9c3293d9813aaffee96058a6f2e3) | Render and verify citations end to end                 | P1       | web   | P5-05            |
| [P5-07](https://app.notion.com/p/3efc9c3293d9815089cbd3d9c1053659) | Gate index promotion, rollback, and Phase 5 completion | P0       | evals | P5-06            |

## Decisions

Owner decisions: the owner supplies the source material and approves every knowledge file; English only (`lang` is still recorded); an optional per-file public `url`, https and host-allowlisted. Design: [ADR-053](../adr/adr-053.md) (ingestion and index lifecycle) and [ADR-054](../adr/adr-054.md) (retrieval, prompt, abstention, citations).

## Pull requests (into `phase/5-rag`)

| PR  | Branch                  | Closes                                |
| --- | ----------------------- | ------------------------------------- |
| 0   | `p5/plan-docs`          | ADRs, phase doc, authoring guide      |
| 1   | `p5/knowledge-pipeline` | P5-02, tooling half of P5-01          |
| 2   | `p5/index-repository`   | P5-03                                 |
| 3   | `p5/vectors-infra`      | infra half of P5-04                   |
| 4   | `p5/ingest-cli`         | app half of P5-04                     |
| 5a  | `p5/prompt-builder`     | P5-05 (pure core)                     |
| 5b  | `p5/rag-service`        | P5-05                                 |
| 6   | `p5/citations-e2e`      | P5-06                                 |
| 7   | `p5/index-lifecycle`    | P5-07 tooling                         |
| 8   | `p5/knowledge-corpus`   | content of P5-01 (waits on the owner) |

## What is built

| Task  | Result                                                                                                                                          | PR       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| P5-01 | Tooling only: strict frontmatter, public-safety scan, authoring guide. **The knowledge files themselves are not written** (owner material).     | #44, #43 |
| P5-02 | Chunker (at most 600 characters, stable ids), metadata limits in UTF-8 bytes, canonical manifest whose hash names the index                     | #44      |
| P5-03 | `IndexRepository` contract, in-memory fake, S3 Vectors adapter, Titan embedder, two contract suites. Live cosine check written, **not yet run** | #45      |
| P5-04 | Vector bucket and ingest/eval roles in Terraform (**not applied**); bounded, idempotent, resumable ingest CLI                                   | #46, #47 |
| P5-05 | `PromptBuilder`, grounded prompt, escaping, citation and highlight policy, `RagService`, `indexReadyStage`; plain service removed               | #48, #49 |
| P5-06 | Citations under the real CSP: hostile text, fabricated markers, unsafe links, mobile viewer (no component change was needed)                    | #50      |
| P5-07 | Eval gate and CLI, promote / rollback / prune with a randomized safety test, runbooks. **No candidate has been promoted**                       | #51      |

Design: [ADR-053](../adr/adr-053.md) and [ADR-054](../adr/adr-054.md). Operations: [index-lifecycle.md](../operations/index-lifecycle.md) and [phase-5-finish.md](../operations/phase-5-finish.md).

## Known limits and provisional values

- `minScore` (0.25) and the eval thresholds are provisional until the real corpus exists (ADR-054).
- `TagResource` and `ListTagsForResource` are not in AWS's S3 Vectors action table, so they are granted on the bucket and its indexes; the first real ingestion confirms it.
- The cosine distance formula (`1 - similarity`) is assumed; `s3-vectors.live.test.ts` pins it when run with `S3VECTORS_LIVE=1`.
- Only the question is embedded, so a follow-up that depends on earlier turns retrieves poorly (Phase 6 evals).
- Until an index is promoted, chat answers 503 before the bot check (`active_index` is `none`).

## Risks and spikes

Mitigations and evidence live in [Spikes and Risks](https://app.notion.com/p/9f15a87a4832454c8f7609a834dab11a).

- [R-02](https://app.notion.com/p/3efc9c3293d9814e8d45ffca9434d812) — S3 Vectors region, limits, and prices (Spike, High)
- [R-09](https://app.notion.com/p/3efc9c3293d9813da5c6e1140a25bde3) — Prompt injection and unsupported claims (Risk, High)
- [R-10](https://app.notion.com/p/3efc9c3293d9818a9d0fc207f12d3107) — Production-only blast radius (Risk, Critical)
- [R-16](https://app.notion.com/p/3efc9c3293d9812f9af1ddd585228ef0) — Wrong index promotion or cleanup (Risk, High)
- [R-17](https://app.notion.com/p/3efc9c3293d981588adce3893bbcdd7a) — Public knowledge, XSS, and log leakage (Risk, High)

## Exit checklist

- [ ] Exit criteria above met
- [x] Lint, typecheck, formatting, and Vitest green in CI (every Phase 5 pull request; 730 root/API tests, 177 Angular tests, 35 browser tests locally)
- [x] Terraform fmt/validate/plan and Checkov green in CI on #46 (the apply itself is an owner step)
- [ ] Phase-specific acceptance, cost, and security checks recorded
- [ ] Post-deploy smoke passed, or "endpoint smoke not applicable" recorded
- [x] No secrets, private contact details, or confidential knowledge committed (no knowledge file exists yet; the safety gate runs in CI over `knowledge/`)
- [ ] ADR and risk changes mirrored in Notion and `docs/`
- [ ] PR merged into `dev`, tagged `phase-5-complete`, Notion phase set to Done

## Evidence

- PRs into the phase branch: #43 to #51 (#44, #46, #50 and #43 first; #45, #47, #48, #49, #51 after retargeting). Each was green on `typescript`, `terraform`, `checkov`, `plan`, and `browser-smoke` before merging. Consolidated PR into `dev`: see the pull request list.
- Not recorded yet (owner steps): the AWS applies, ingestion and its no-op re-run, the gate report, promotion, the rollback drill, the bounded chat window, the 24-hour cost figure, and sign-off.
- Tag: `phase-5-complete`
- CI run:
- Deployment/smoke:
- Sign-off:

Sign-off and detailed results are tracked in the [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55).
