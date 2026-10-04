# AWS and GitHub access audit and setup

Covers P1-02. The account decision is [ADR-047](../adr/adr-047.md): portfolio v2 shares the owner's existing AWS account with enforced isolation. Account IDs, email addresses, and ARNs that contain them stay out of Git; they live in gitignored `*.tfvars` files and repository variables.

## Audit findings (2026-10-04, read-only)

| Check                       | Result                                                              | Action                                                |
| --------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| Root MFA / root access keys | MFA enabled, no root keys                                           | None                                                  |
| AWS Organizations           | Not in use                                                          | Leave as is (not needed, ADR-047)                     |
| IAM Identity Center         | No instance                                                         | Not used                                              |
| Current CLI identity        | IAM user with one active access key (created 2026-05-14) and no MFA | Register MFA; use it only to assume the operator role |
| Other workloads             | Several unrelated projects and an earlier live portfolio            | Isolation rules in ADR-047                            |
| GitHub OIDC provider        | Already exists, shared by ten roles of other projects               | Read it as a data source; never manage it             |
| Existing budget             | One unrelated monthly budget                                        | Do not modify; v2 gets its own budgets (P1-08)        |
| Cost-allocation tags        | `Application`, `Environment`, `CostScope` active                    | Reuse these keys                                      |
| Bedrock Haiku 4.5 profiles  | `us.` and `global.` system profiles listed in us-east-1             | Listing only; invocation is verified in P1-01         |
| Month-to-date spend         | Effectively zero                                                    | None                                                  |

## Human access: MFA-gated operator role

Short-lived credentials without changing the account. A role `portfolio-v2-prod-operator` is assumable only by the owner's IAM user, only with MFA from the last hour, for one-hour sessions. AdministratorAccess sits behind that MFA gate; isolation in the shared account comes from the naming rules and the plan guard (ADR-047), not from this role's permissions.

1. **Register an MFA device** on the IAM user behind the `default` CLI profile (console: IAM, Users, Security credentials, Assign MFA device). Checked 2026-10-04: the user has no MFA device and the account has no virtual MFA devices. Root MFA is separate and does not count.
2. **Create the role** (once, by hand, since it precedes Terraform). The trust policy allows `sts:AssumeRole` for the one IAM user, with `Bool aws:MultiFactorAuthPresent = true` and `NumericLessThan aws:MultiFactorAuthAge = 3600`. Maximum session 3600 seconds. Attach the AWS-managed `AdministratorAccess` policy. Tag it `Application=portfolio-v2`, `Environment=prod`, `CostScope=portfolio-v2-prod`, `ManagedBy=manual-bootstrap`.
3. **Add a CLI profile** to `~/.aws/config` (placeholders in angle brackets, never committed):

   ```ini
   [profile portfolio-v2]
   role_arn = arn:aws:iam::<ACCOUNT_ID>:role/portfolio-v2-prod-operator
   source_profile = default
   mfa_serial = arn:aws:iam::<ACCOUNT_ID>:mfa/<DEVICE_NAME>
   region = us-east-1
   duration_seconds = 3600
   ```

4. **Verify**: `aws sts get-caller-identity --profile portfolio-v2` prompts for the MFA code and returns an assumed-role ARN for `portfolio-v2-prod-operator`. Negative check: `aws sts assume-role --role-arn <role arn> --role-session-name probe` from the `default` profile (no MFA) must fail with AccessDenied.

All Terraform runs, probes, and scripts for this project use `--profile portfolio-v2` or the OIDC roles. They never use the `default` profile's key directly.

## GitHub deployment gate

GitHub documents required environment reviewers as available only for public repositories on Free, Pro, and Team plans. The repository is private, so the approval gate cannot be assumed. P1-12 attempts to create the `production` environment with a required reviewer and records the actual result. Until a gate is proven, CI keeps `apply` disabled (ADR-035, R-13) and the operator applies from a reviewed commit with the MFA-gated profile.

## Budget owner

The repository owner owns the budgets, receives alerts, and operates the kill-switch recovery steps in the runbook. The alert email address is supplied through a gitignored `terraform.tfvars` (`alert_email`) and is never committed.

## Evidence still to record

- [ ] MFA registered, role created, and `get-caller-identity --profile portfolio-v2` shows the assumed role; the no-MFA assume attempt is denied (steps 1 to 4).
- [ ] Result of the GitHub environment reviewer attempt (P1-12).
- [ ] Quotas relevant to v2: Lambda concurrency and Bedrock limits (P1-01).
