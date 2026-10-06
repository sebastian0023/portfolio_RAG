# Phase 5: RAG

Status: Deployed and verified from `dev` (2026-10-05) except the owner's browser check of a grounded answer and the 24-hour cost figure. Chat is off; the first index is active.

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

| Task  | Result                                                                                                                                                                                       | PR       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| P5-01 | Tooling only: strict frontmatter, public-safety scan, authoring guide. **The knowledge files themselves are not written** (owner material).                                                  | #44, #43 |
| P5-02 | Chunker (at most 600 characters, stable ids), metadata limits in UTF-8 bytes, canonical manifest whose hash names the index                                                                  | #44      |
| P5-03 | `IndexRepository` contract, in-memory fake, S3 Vectors adapter, Titan embedder, two contract suites. Live cosine check written, **not yet run**                                              | #45      |
| P5-04 | Vector bucket and ingest/eval roles in Terraform (applied 2026-10-05); bounded, idempotent, resumable ingest CLI                                                                             | #46, #47 |
| P5-05 | `PromptBuilder`, grounded prompt, escaping, citation and highlight policy, `RagService`, `indexReadyStage`; plain service removed                                                            | #48, #49 |
| P5-06 | Citations under the real CSP: hostile text, fabricated markers, unsafe links, mobile viewer (no component change was needed)                                                                 | #50      |
| P5-07 | Eval gate and CLI, promote / rollback / prune with a randomized safety test, runbooks. first index promoted 2026-10-05, rollback drill passed; active index is now `chunks-b89ecef72df4c1c0` | #51      |

Design: [ADR-053](../adr/adr-053.md) and [ADR-054](../adr/adr-054.md). Operations: [index-lifecycle.md](../operations/index-lifecycle.md) and [phase-5-finish.md](../operations/phase-5-finish.md).

## Known limits and provisional values

- `minScore` (0.25) and the eval thresholds are provisional until the real corpus exists (ADR-054).
- `TagResource` and `ListTagsForResource` are not in AWS's S3 Vectors action table, so they are granted on the bucket and its indexes; the first real ingestion confirms it.
- The cosine distance formula (`1 - similarity`) is assumed; `s3-vectors.live.test.ts` pins it when run with `S3VECTORS_LIVE=1`.
- Only the question is embedded, so a follow-up that depends on earlier turns retrieves poorly (Phase 6 evals).
- Chat answers 503 before the bot check whenever `active_index` is `none`.
- The first real ingestion confirmed that `TagResource` and `ListTagsForResource` work as granted.
- One golden case (`current-role`, "Where does Daniel work now…") counts as a miss: the FAQ chunk "What is Daniel doing now?" ranks first and does state his CORAE role, but the case accepts only the CORAE experience file, and that file's overview chunk is not in the top 8. The owner confirmed the FAQ and the CORAE file state the same fact (the owner works at CORAE), so on 2026-10-05, after seeing the result, the case was changed to accept `faq-general` as well as `exp-corae`. Both gate reports above were produced with the stricter original set; the next gate run uses the corrected one.

## Risks and spikes

Mitigations and evidence live in [Spikes and Risks](https://app.notion.com/p/9f15a87a4832454c8f7609a834dab11a).

- [R-02](https://app.notion.com/p/3efc9c3293d9814e8d45ffca9434d812) — S3 Vectors region, limits, and prices (Spike, High)
- [R-09](https://app.notion.com/p/3efc9c3293d9813da5c6e1140a25bde3) — Prompt injection and unsupported claims (Risk, High)
- [R-10](https://app.notion.com/p/3efc9c3293d9818a9d0fc207f12d3107) — Production-only blast radius (Risk, Critical)
- [R-16](https://app.notion.com/p/3efc9c3293d9812f9af1ddd585228ef0) — Wrong index promotion or cleanup (Risk, High)
- [R-17](https://app.notion.com/p/3efc9c3293d981588adce3893bbcdd7a) — Public knowledge, XSS, and log leakage (Risk, High)

## Exit checklist

- [ ] Exit criteria above met: the index is built, gated, promoted and rolled back, and the window smoke passed; **a grounded, cited answer in a real browser is still to be confirmed by the owner**
- [x] Lint, typecheck, formatting, and Vitest green in CI (every Phase 5 pull request; 730 root/API tests, 177 Angular tests, 35 browser tests locally)
- [x] Terraform fmt/validate/plan and Checkov green in CI on #46 (the apply itself is an owner step)
- [ ] Phase-specific acceptance, cost, and security checks recorded (acceptance and security below; the 24-hour cost figure is still to come)
- [x] Post-deploy smoke passed (chat off, and the bounded window)
- [x] No secrets, private contact details, or confidential knowledge committed (no knowledge file exists yet; the safety gate runs in CI over `knowledge/`)
- [ ] ADR and risk changes mirrored in Notion and `docs/`
- [ ] PR merged into `dev`, tagged `phase-5-complete`, Notion phase set to Done

## Evidence

- PRs into the phase branch: #43 to #51 (#44, #46, #50 and #43 first; #45, #47, #48, #49, #51 after retargeting). Each was green on `typescript`, `terraform`, `checkov`, `plan`, and `browser-smoke` before merging. Consolidated PR into `dev`: see the pull request list.
- Consolidated PR into `dev`: #52 (merge `58d7f0c`); corpus and evidence: #53 (merge `039509c`). CI infrastructure note: GitHub Actions was partially degraded on 2026-10-05, so several jobs were cancelled with no runner assigned; they passed on re-run, and no check was skipped or forced.
- Applied from `dev` at `58d7f0c` with the MFA operator role. Bootstrap: 1 changed (the plan role's read policy), then no changes. Stack: 5 added and 5 changed, 0 destroyed (vector bucket, ingest and eval roles and policies; API policy, Lambda version and alias, budget-action roles); the guard reported no violations, the bundle hash `2d555896…` equalled CI's, and a second plan reported no changes.
- Kill switch (simulator): the budget-action role may attach and detach the deny policy on `portfolio-v2-prod-api`, `-ingest` and `-eval`; it is implicitly denied on the operator role, the CI plan role, and for any other policy.
- Ingest (as the ingest role): dry run, then `--apply` created `chunks-351064a707096da2` (9 files, 34 chunks, 34 embedding calls, estimated $0.00005); a second `--apply` was a no-op with 0 embedding calls.
- Gate (as the eval role, 20 golden questions, real Titan, S3 Vectors, Haiku): hit@5 0.923 (12 of 13), off-topic abstention 1.0, injection leaks 0, valid citations 1.0, largest billed prompt 690 tokens. Passed on thresholds fixed before the run. Reports in `evals/reports/`, manifests in `evals/indexes/`.
- Promotion and rollback drill (chat off): promoted `chunks-351064a7…`, built and gated a salted second index `chunks-ec11aefd…`, promoted it, rolled back (`status` showed the first index active and the second as the previous one), `eval --smoke` ran against the restored index, and `prune` reported nothing to delete.
- Corpus update (2026-10-05): the CORAE file was expanded from the owner's notes (#55), giving 38 chunks and a new index `chunks-bb5e0ea4bc36dd0f`. Ingested (38 embedding calls, then a no-op re-run), gated with the same metrics as before (hit@5 0.923, abstention 1.0, 0 leaks, citations 1.0, 690 tokens; the `current-role` case still misses, so it is not a content gap) and promoted. The first index is the rollback target. Chat stayed off.
- Availability and contact (2026-10-05): the FAQ gained the owner-confirmed answers (open to internships; contact through the LinkedIn link on the card; no phone or email, no CV download promised until a PDF is hosted) and the golden set gained `internships` and `contact` (22 cases in all). New index `chunks-b89ecef72df4c1c0` (40 chunks, 40 embedding calls, then a no-op re-run) passed the gate with hit@5 1.0 (15 of 15, with the corrected `current-role` case), abstention 1.0, 0 injection leaks, citations 1.0, 690 tokens, and was promoted; the two earlier indexes are the rollback targets. Chat stayed off. The web card was also published from `dev` at `bb4f75b` with the real profile (no placeholders).
- Smoke: chat off, every check passed; bounded window (`chat_enabled` true, then false, read back), `smoke-edge.ts --window` passed all five checks (forged and missing passes refused, a bogus Turnstile token refused by Cloudflare, uncached JSON, malformed body 400).
- Not recorded yet: the owner's browser check on desktop and phone (grounded answer with working citations and viewer, off-topic abstention, injection attempt, the quota counter text and Stop button), the 24-hour Cost Explorer figure for Titan, Haiku and S3 Vectors, the live cosine test (`S3VECTORS_LIVE=1`), the Notion mirror, and sign-off.
- Tag: `phase-5-complete`
- CI run:
- Deployment/smoke:
- Sign-off:

Sign-off and detailed results are tracked in the [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55).
