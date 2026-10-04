# Infrastructure

Terraform for the single production stack (ADR-005, ADR-032, ADR-047). Nothing here is applied by CI: pull requests run a read-only plan, and the owner applies from a reviewed commit with the SSO profile (ADR-035, R-13).

## Layout

| Path                | Purpose                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `bootstrap/`        | Root that creates the remote state bucket and the CI plan role. Run once per account.     |
| `modules/<concern>` | Reusable modules, one per concern (ADR-006). Narrow inputs and outputs, no module cycles. |
| `stack/`            | The single stack root (added with the SSM and budget modules).                            |
| `scripts/`          | `check-plan.ts`, the plan guard used locally and in CI.                                   |

Allowed module names: `bootstrap`, `oidc`, `edge`, `web`, `api`, `auth`, `storage`, `vectors`, `budgets`, `ssm`, `observability`.

## Conventions (ADR-047)

- Names: `portfolio-v2-<env>-<concern>`, with `env` fixed to `prod`. SSM parameters live under `/portfolio-v2/prod/`.
- Provider `default_tags`: `Application=portfolio-v2`, `Environment=prod`, `CostScope=portfolio-v2-prod`, `ManagedBy=terraform`.
- The GitHub OIDC provider is shared with other projects. It is only ever read through a data source.
- Never reference another project's resources, state bucket, or lock table.
- No secret values, account IDs, `*.tfvars`, `backend.hcl`, state, or plan files in Git. Secret names are provisioned here; values are injected out of band (ADR-023, R-18).

## Plan guard

```sh
terraform show -json plan.out > plan.json
node infra/scripts/check-plan.ts plan.json
```

Fails when a plan destroys or replaces a protected stateful resource, changes a resource whose name is outside the prefix, manages the shared OIDC provider, or uses a resource type the guard does not list. Adding a service means editing the allowlist in `check-plan.ts` and its tests.

## Bootstrap and state migration (owner, once)

Prerequisite: SSO profile `portfolio-v2` works ([access guide](../docs/operations/access.md)).

```sh
export AWS_PROFILE=portfolio-v2 AWS_REGION=us-east-1
aws sso login
cd infra/bootstrap
terraform init
terraform plan -out bootstrap.tfplan
terraform show -json bootstrap.tfplan > plan.json && node ../scripts/check-plan.ts plan.json
terraform apply bootstrap.tfplan      # creates the state bucket and plan role, state stays local
```

Then migrate the bootstrap state into the bucket it created:

1. Record `terraform output -raw state_bucket_name` and write `backend.hcl` (gitignored) with `bucket = "<name>"` and `region = "us-east-1"`.
2. Add `backend.tf` to the root: `terraform { backend "s3" { key = "bootstrap/terraform.tfstate", use_lockfile = true, encrypt = true } }`.
3. `terraform init -migrate-state -backend-config=backend.hcl`, answer `yes`, then confirm `terraform plan` reports no changes.
4. Delete the local `terraform.tfstate*` files and commit `backend.tf`.

Lock check: leave `terraform apply` waiting at its confirmation prompt in one shell, and run `terraform plan -lock-timeout=0s` in another. The second command must fail with a state-lock error, proving the native lockfile works without a DynamoDB table.

## Local validation

```sh
terraform fmt -check -recursive infra
terraform -chdir=infra/bootstrap init -backend=false && terraform -chdir=infra/bootstrap validate
checkov -d infra --framework terraform
```
