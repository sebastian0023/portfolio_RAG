# Index lifecycle: ingest, gate, promote, roll back, prune

Written for the repository owner. Covers P5-04 and P5-07. Related: [ADR-019](../adr/adr-019.md), [ADR-053](../adr/adr-053.md), [ADR-054](../adr/adr-054.md), R-16, [kill switch](kill-switch.md), [applying infrastructure](apply-procedure.md).

## The idea

Retrieval reads one vector index, named by the SSM parameter `/portfolio-v2/prod/active_index`. An index is **built once from a reviewed corpus, never edited**, and named by a hash of what is in it (`chunks-` plus 16 hex characters). Changing the corpus, the chunker, the embedding settings, or the metadata layout produces a different name. So updating the knowledge base is: build a new index, check it, then flip one parameter. Rolling back is flipping it back.

```
knowledge/*.md --ingest--> chunks-<hash> (pending -> complete) --eval gate--> report --promote--> active_index
```

Nothing in this flow can touch the live index except `promote` and `rollback`, and only the operator role runs those.

## Roles and who runs what

| Step                              | Tool                                        | Runs as                      | Why                                                 |
| --------------------------------- | ------------------------------------------- | ---------------------------- | --------------------------------------------------- |
| Ingest                            | `node apps/api/dist/cli/ingest.mjs`         | `portfolio-v2-prod-ingest`   | Spends on Titan; a budget kill-switch target (R-14) |
| Eval gate                         | `node apps/api/dist/cli/eval-candidate.mjs` | `portfolio-v2-prod-eval`     | Spends on Titan and the model; a kill-switch target |
| Promote, roll back, prune, status | `node infra/scripts/index-lifecycle.ts`     | `portfolio-v2-prod-operator` | Changes `active_index` and deletes indexes          |

The ingest and eval tools check their own identity (STS) and refuse to run as any other role, so the operator role cannot be used to get around the kill switch. Neither of them can delete anything or write SSM. Only the operator tool can.

One-time setup, in `~/.aws/config` (the account id is in `docs/operations/access.md`):

```ini
[profile portfolio-v2-ingest]
role_arn = arn:aws:iam::<account>:role/portfolio-v2-prod-ingest
source_profile = portfolio-v2
[profile portfolio-v2-eval]
role_arn = arn:aws:iam::<account>:role/portfolio-v2-prod-eval
source_profile = portfolio-v2
```

Build the tools from a clean checkout (keep it out of iCloud, see the apply procedure): `npm ci && npm run build:cli -w @portfolio/api`. They land in `apps/api/dist/cli/`.

## 1. Ingest a candidate

Always dry-run first. It builds no AWS client and creates nothing:

```sh
node apps/api/dist/cli/ingest.mjs            # prints the plan: files, chunks, estimated tokens and cost, the index name
```

Read it. The index name must be the one you expect, and the cost should be a fraction of a cent. If the corpus fails the public-safety gate it prints the file, line, and rule (never the text) and stops.

Then, as the ingest role:

```sh
eval "$(aws configure export-credentials --profile portfolio-v2-ingest --format env)"
export AWS_REGION=us-east-1
node apps/api/dist/cli/ingest.mjs --apply
```

It creates the index tagged `IngestStatus=pending`, embeds the chunks (at most 5 requests per second, one retry each, a hard ceiling on total calls), writes them in batches, then checks that the index holds exactly the manifest's chunk ids and that a search for one chunk's own vector finds it. Only then does it tag the index `complete` and write the public manifest to `evals/indexes/<index>.json`.

- **Run it again** and it must report `noop` with 0 embedding calls. That is the idempotency evidence to record.
- **If it fails partway**, nothing reads the half-built index. Run the same command again: it resumes, embedding only what is missing.
- It refuses to build into the active index unless that index is already complete.
- `--salt <word>` builds a different index from the same corpus. Use it for the rollback drill.

Commit `evals/indexes/<index>.json`. It names every source and chunk id with hashes and contains no chunk text.

## 2. Run the quality gate

As the eval role (same `export-credentials` pattern with the `portfolio-v2-eval` profile):

```sh
node apps/api/dist/cli/eval-candidate.mjs --index chunks-<hash>          # full gate, writes evals/reports/<index>-<time>.json
node apps/api/dist/cli/eval-candidate.mjs --index chunks-<hash> --smoke  # 3 cases, no report, cannot promote
```

It runs the real answer path against the **named candidate** (Titan, S3 Vectors, and the model in `llm_config`) over `evals/retrieval/golden.jsonl`, skipping admission so it uses no visitor quota. It exits non-zero unless all of these hold (provisional thresholds, see ADR-054):

| Check                                             | Threshold                |
| ------------------------------------------------- | ------------------------ |
| Answerable questions retrieve the expected source | at least 90%             |
| Off-topic questions abstain                       | at least 90%             |
| Injection cases leak a forbidden string           | 0                        |
| Answerable answers cite a real source             | 100%                     |
| Largest billed prompt                             | within `promptMaxTokens` |

The report holds metrics and case ids only, never an answer or a question. It records the index, the manifest hash, the git commit, and the model configuration. A passing result on a finite set is evidence, not proof of immunity to injection.

## 3. Promote

```sh
eval "$(aws configure export-credentials --profile portfolio-v2 --format env)"
node infra/scripts/index-lifecycle.ts status
node infra/scripts/index-lifecycle.ts promote --candidate chunks-<hash> --report evals/reports/<file>.json           # dry run
node infra/scripts/index-lifecycle.ts promote --candidate chunks-<hash> --report evals/reports/<file>.json --apply
```

`promote` refuses unless: the index exists and is tagged complete; its manifest tag equals the manifest on disk; it holds exactly the manifest's number of vectors; the report passed, is for this index and this build, is under 24 hours old, and was run with the **same `llm_config`** as now. It then re-reads `active_index`, writes it, and requires SSM to answer with exactly the next version. SSM has no compare-and-swap, so a changed version aborts the command and tells you to run `status`. Do not run two promotions at once.

After `--apply`, wait **at least 35 seconds**: running functions cache the configuration for 30 seconds. Then run the smoke checks.

## 4. Roll back

```sh
node infra/scripts/index-lifecycle.ts rollback            # dry run: goes back to the most recent previous index
node infra/scripts/index-lifecycle.ts rollback --apply
node infra/scripts/index-lifecycle.ts rollback --to none --apply   # switch retrieval off; chat then answers 503
```

The target must exist and be complete. Going back to `none` is never the default.

Rolling the **Lambda** back to a version older than Phase 5 restores the plain model with no retrieval. Set `chat_enabled` to `false` first (see the [kill switch](kill-switch.md)).

## 5. Prune

```sh
node infra/scripts/index-lifecycle.ts prune            # dry run: prints what would go and why everything else stays
node infra/scripts/index-lifecycle.ts prune --apply
```

It keeps the **active index and the previous two**, anything that was live in the last 10 minutes (longer than the 30 second cache plus the function timeout, so no running function can still be reading it), anything created in the last 24 hours (a candidate being built or evaluated), and any name that is not `chunks-<16 hex>`. It refuses to run if the parameter history is empty or unreadable, or if the active index is not in the bucket, and it re-plans before every delete. Terraform never deletes indexes; the plan guard rejects a Terraform-managed index.

## Evidence to record in the phase doc

Index name and manifest hash; the dry-run and apply output of the first ingest (chunk count, embedding calls, estimated cost); the second `--apply` showing `noop`; the gate report summary; the promotion (previous value and new value); the rollback drill (`status` before and after, and `--smoke` against the restored index); a `prune` dry run showing nothing deletable; and the Cost Explorer figure for Titan, the model, and S3 Vectors after 24 hours.
