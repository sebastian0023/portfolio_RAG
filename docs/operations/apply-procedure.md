# Applying infrastructure (manual, operator-run)

Covers P1-12. Related: ADR-035, ADR-047, R-10, R-13, R-14.

## Why this is manual

On 2026-10-04 GitHub refused to create a `production` environment with a required reviewer: _"Please ensure the billing plan supports the required reviewers protection rule."_ No approval gate can be enforced for this private repository, so CI does not apply (ADR-035). Concretely:

- Pull requests get a **read-only** `terraform plan` through the `portfolio-v2-prod-gha-plan` role, which can be assumed only by `pull_request` runs of this repository.
- **No apply role exists.** Nothing in CI can change infrastructure, so an untrusted pull request has no path to production (R-14).
- Applies are run by the owner with the MFA-gated operator role, from a reviewed commit, serialized by the state lock.

## Procedure

1. **Start from reviewed code.** The change must be merged into its phase branch (or `dev`) with CI green, including the `plan` job. Check out that exact commit; the tree must be clean.
   ```sh
   git fetch origin && git checkout <branch> && git pull --ff-only
   git status --short            # must print nothing
   git rev-parse --short HEAD    # record this
   ```
2. **Sign in with MFA and export the session** (Terraform cannot prompt for a code):
   ```sh
   aws sts get-caller-identity --profile portfolio-v2
   eval "$(aws configure export-credentials --profile portfolio-v2 --format env)"
   export AWS_REGION=us-east-1
   ```
3. **Plan to a file and run the guard** in the root you are changing (`infra/bootstrap` or `infra/stack`):
   ```sh
   terraform init -backend-config=backend.hcl
   terraform plan -out=apply.tfplan
   terraform show -json apply.tfplan > plan.json && node ../scripts/check-plan.ts plan.json
   ```
   The guard must report no violations. Read the plan itself: it should match what the pull request described, and the same numbers CI printed.
4. **Apply the saved plan, never a fresh one**, and never with `-lock=false`:
   ```sh
   terraform apply apply.tfplan
   ```
   The S3 lockfile makes concurrent applies fail, which serializes deployments.
5. **Verify.** `terraform plan` must now report no changes. For behavior changes, run the relevant check (for example the kill-switch drill in [kill-switch.md](kill-switch.md)).
6. **Record** the commit SHA, the plan summary (counts of add, change, destroy), and the verification result in the pull request or the Notion phase page. Delete `*.tfplan` and `plan.json`; they contain account details and are gitignored.

## Deploying application code (Phase 3)

The API and the web app are deployed from the **same commit** so the two never disagree about the wire format (ADR-035, ADR-049).

| Artifact        | How it ships                                                                                                                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API Lambda code | Through Terraform. `npm run build -w @portfolio/api` writes a deterministic bundle, the `api` module zips it, and `source_code_hash` plus `publish = true` create a new version that the `live` alias points at. It rides the normal plan, guard, and apply, under the state lock. |
| SPA files       | Through `infra/scripts/deploy-web.ts`, after the apply. Hundreds of content-hashed files would churn every plan, and the CI plan job would need an Angular build, so the files are not Terraform resources.                                                                        |

1. `npm ci`, then `npm run build -w @portfolio/api`. Print the bundle hash: `shasum -a 256 apps/api/dist/lambda/index.mjs`. It must equal the hash the CI `plan` job printed for the same commit; if it does not, stop (a dependency or toolchain differs).
2. Plan, guard, and apply the `infra/stack` root as above, in the same working tree with no rebuild in between. The plan shows one new function version and an alias update; any other change is a surprise.
3. Run `node infra/scripts/deploy-web.ts` (add `--dry-run` first to read the upload list). It refuses a dirty tree, a commit that is not pushed to `origin/dev` or `origin/phase/*`, a bucket outside the `portfolio-v2-` prefix, conflict copies such as `index 2.html`, and an `index.html` with an inline script. It uploads hashed assets first and `index.html` last, writes `version.json` with the commit, and invalidates only `/index.html` and `/version.json`.
4. Run `node infra/scripts/smoke-edge.ts` (chat off). Add `--with-chat` only inside a window you opened by setting `chat_enabled` to `true`; close the window straight afterwards.
5. Record the commit, the bundle hash, the plan counts, and the smoke output.

Keep the checkout out of iCloud or another synced folder for applies and deploys: sync conflict copies end up inside `dist/` and inside the Lambda bundle's inputs.

### Rolling back

- **API:** re-apply the previous commit (the alias returns to the earlier version). In an emergency, move the alias directly, then follow with a revert pull request so Terraform agrees: `aws lambda update-alias --function-name portfolio-v2-prod-api --name live --function-version <N> --profile portfolio-v2`.
- **Web:** run `deploy-web.ts` from the previous commit. Old hashed files stay in the bucket, so open tabs keep working.
- **Stop answering without a rollback:** set `chat_enabled` to `false` ([kill-switch.md](kill-switch.md)).

## Never

- Use `-target`, `terraform import`, or `terraform state` commands on resources outside this stack, or touch another project's resources (ADR-047).
- Destroy or replace the state bucket, or any resource the guard marks as protected (ADR-033).
- Create or modify the shared GitHub OIDC provider.
- Paste plan output containing account details into issues or pull requests.

## What it would take to enable CI apply

All of these, recorded in a new ADR:

1. An approval gate GitHub actually enforces for this repository (a plan that supports required reviewers, or a public repository), proven by a blocked deployment.
2. An apply role created in Terraform, trusted only for the `production` environment of this repository, scoped to the `portfolio-v2` prefix, with a permissions boundary so it cannot create more powerful roles.
3. A saved-plan flow: the plan job uploads an immutable plan, and the apply job applies exactly that file after approval.
4. A concurrency group so only one deployment runs at a time, restricted to the `dev` branch.
