# Infrastructure

Terraform for the single production stack (ADR-005, ADR-032, ADR-047). Nothing here is applied by CI: pull requests run a read-only plan, and the owner applies from a reviewed commit with the MFA-gated profile (ADR-035, R-13).

## Layout

| Path                | Purpose                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `bootstrap/`        | Root that creates the remote state bucket and the CI plan role. Run once per account.      |
| `modules/<concern>` | Reusable modules, one per concern (ADR-006). Narrow inputs and outputs, no module cycles.  |
| `stack/`            | The single stack root: `ssm`, `budgets`, `web`, `storage`, `api`, and `edge`.              |
| `scripts/`          | `check-plan.ts` (plan guard), `deploy-web.ts` and `smoke-edge.ts` (operator-run, Phase 3). |

The `vectors` module holds the S3 Vectors bucket and the ingest and eval roles (ADR-053). It owns only the bucket; indexes are created by the ingest tool, and the plan guard rejects a Terraform-managed index.

Allowed module names: `bootstrap`, `oidc`, `edge`, `web`, `api`, `auth`, `storage`, `vectors`, `budgets`, `ssm`, `observability`.

## Conventions (ADR-047)

- Names: `portfolio-v2-<env>-<concern>`, with `env` fixed to `prod`. SSM parameters live under `/portfolio-v2/prod/`.
- Provider `default_tags`: `Application=portfolio-v2`, `Environment=prod`, `CostScope=portfolio-v2-prod`, `ManagedBy=terraform`.
- The GitHub OIDC provider is shared with other projects. It is only ever read through a data source, by ARN.
- Repositories with immutable subject claims put the numeric owner and repository ids in the token: `repo:<owner>@<owner_id>/<repo>@<repo_id>:pull_request`. Check `gh api repos/<owner>/<repo>/actions/oidc/customization/sub` before writing a trust policy; the plain `repo:<owner>/<repo>:...` form never matches such a repository.
- Never reference another project's resources, state bucket, or lock table.
- No secret values, account IDs, `*.tfvars`, `backend.hcl`, state, or plan files in Git. Secret names are provisioned here; values are injected out of band (ADR-023, R-18).

## Plan guard

```sh
terraform show -json plan.out > plan.json
node infra/scripts/check-plan.ts plan.json
```

Fails when a plan destroys or replaces a protected stateful resource, changes a resource whose name is outside the prefix, manages the shared OIDC provider, or uses a resource type the guard does not list. Adding a service means editing the allowlist in `check-plan.ts` and its tests.

## Running Terraform locally

Prerequisite: the MFA-gated profile `portfolio-v2` works ([access guide](../docs/operations/access.md)).

The Terraform AWS provider cannot prompt for an MFA code, so export the CLI's cached session first. Run `aws sts get-caller-identity --profile portfolio-v2` once to sign in with MFA; the session lasts one hour.

```sh
eval "$(aws configure export-credentials --profile portfolio-v2 --format env)"
export AWS_REGION=us-east-1
cd infra/bootstrap
terraform init -backend-config=backend.hcl   # backend.hcl is gitignored: bucket = "<state bucket>", region = "us-east-1"
terraform plan -out bootstrap.tfplan
terraform show -json bootstrap.tfplan > plan.json && node ../scripts/check-plan.ts plan.json
terraform apply bootstrap.tfplan
```

## First-ever bootstrap and state migration (done 2026-10-04)

Only needed again if the account is rebuilt. The bucket cannot hold its own state before it exists, so:

1. Move `backend.tf` aside, then `terraform init`, `plan`, guard, and `apply` with local state.
2. Read the bucket name from the local state **before** restoring `backend.tf` (once a backend block exists, `terraform output` needs a re-init and returns nothing). Write `backend.hcl`.
3. Restore `backend.tf` and run `terraform init -migrate-state -force-copy -backend-config=backend.hcl`.
4. Check that the object exists in the bucket and that `terraform plan` reports no changes. Terraform empties the local `terraform.tfstate` and leaves a `.backup`; delete both only after that check.

Lock check (done 2026-10-04): with a scratch root using the same bucket and a `lock-test/` key, one `terraform apply` was left waiting at its approval prompt while a second `terraform plan -lock-timeout=0s` ran. The second failed with `Error acquiring the state lock` (HTTP 412) and showed the holder. No lock or state object remained afterwards, and no DynamoDB table is involved.

## CI

`plan` in `.github/workflows/pr-checks.yml` assumes `portfolio-v2-prod-gha-plan` through OIDC for same-repository pull requests only, runs a read-only `terraform plan -lock=false`, and then the plan guard. `oidc-negative-test.yml` runs from a branch push and passes only when AWS **denies** that assumption. Repository variables `AWS_REGION`, `TF_STATE_BUCKET`, and `AWS_PLAN_ROLE_ARN` hold the settings; they are variables, not secrets, and nothing sensitive is stored.

## Local validation

```sh
terraform fmt -check -recursive infra
terraform -chdir=infra/bootstrap init -backend=false && terraform -chdir=infra/bootstrap validate
checkov -d infra --framework terraform
```

## Application deploys (Phase 3)

The API bundle is a plan input: `npm run build -w @portfolio/api` must run before `terraform plan` in `infra/stack`, locally and in the CI `plan` job. The SPA is published by `infra/scripts/deploy-web.ts` and checked by `infra/scripts/smoke-edge.ts`. See [Applying infrastructure](../docs/operations/apply-procedure.md).
