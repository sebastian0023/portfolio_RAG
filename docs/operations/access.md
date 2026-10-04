# AWS and GitHub access audit and setup

Covers P1-02. The account decision is [ADR-047](../adr/adr-047.md): portfolio v2 shares the owner's existing AWS account with enforced isolation. Account IDs, email addresses, and ARNs that contain them stay out of Git; they live in gitignored `*.tfvars` files and repository variables.

## Audit findings (2026-10-04, read-only)

| Check                       | Result                                                              | Action                                             |
| --------------------------- | ------------------------------------------------------------------- | -------------------------------------------------- |
| Root MFA / root access keys | MFA enabled, no root keys                                           | None                                               |
| AWS Organizations           | Not in use                                                          | Enable (step 1)                                    |
| IAM Identity Center         | No instance                                                         | Enable (step 2)                                    |
| Current CLI identity        | IAM user with one active access key (created 2026-05-14) and no MFA | Stop using it for this project; leave it otherwise |
| Other workloads             | Several unrelated projects and an earlier live portfolio            | Isolation rules in ADR-047                         |
| GitHub OIDC provider        | Already exists, shared by ten roles of other projects               | Read it as a data source; never manage it          |
| Existing budget             | One unrelated monthly budget                                        | Do not modify; v2 gets its own budgets (P1-08)     |
| Cost-allocation tags        | `Application`, `Environment`, `CostScope` active                    | Reuse these keys                                   |
| Bedrock Haiku 4.5 profiles  | `us.` and `global.` system profiles listed in us-east-1             | Listing only; invocation is verified in P1-01      |
| Month-to-date spend         | Effectively zero                                                    | None                                               |

## Human access: IAM Identity Center (steps for the owner)

These are console steps because they change the whole account. Nothing here modifies existing IAM users, roles, or workloads.

1. **Enable AWS Organizations** (all features) from the management console. AWS sends a verification email to the account's root address; confirm it. This account becomes the management account.
2. **Enable IAM Identity Center** in `us-east-1` (use the organization instance).
3. **Create the owner user** in the Identity Center directory and register an MFA device on first sign-in.
4. **Create a permission set** named `PortfolioOperator` (managed policy `AdministratorAccess`, session duration 4 hours) and assign the owner user to this account with it.
5. **Configure the CLI**: `aws configure sso --profile portfolio-v2` (SSO start URL from the Identity Center settings, region `us-east-1`), then `aws sso login --profile portfolio-v2`.
6. **Verify**: `aws sts get-caller-identity --profile portfolio-v2` must return an assumed-role ARN containing `AWSReservedSSO_PortfolioOperator`, not an IAM user.

All Terraform runs, probes, and scripts for this project use `--profile portfolio-v2` or the OIDC roles. They never use the old access key.

## GitHub deployment gate

GitHub documents required environment reviewers as available only for public repositories on Free, Pro, and Team plans. The repository is private, so the approval gate cannot be assumed. P1-12 attempts to create the `production` environment with a required reviewer and records the actual result. Until a gate is proven, CI keeps `apply` disabled (ADR-035, R-13) and the operator applies from a reviewed commit with the SSO profile.

## Budget owner

The repository owner owns the budgets, receives alerts, and operates the kill-switch recovery steps in the runbook. The alert email address is supplied through a gitignored `terraform.tfvars` (`alert_email`) and is never committed.

## Evidence still to record

- [ ] Identity Center sign-in works and `get-caller-identity` shows the SSO role (step 6).
- [ ] Result of the GitHub environment reviewer attempt (P1-12).
- [ ] Quotas relevant to v2: Lambda concurrency and Bedrock limits (P1-01).
