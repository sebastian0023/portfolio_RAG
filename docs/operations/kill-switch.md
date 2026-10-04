# Budget kill switch

Covers P1-08 and P1-09. Related: ADR-026, ADR-047, R-03, R-06, and the runbook entry "Budget or emergency kill switch" in the Notion plan.

## Design

| Piece                    | Detail                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Budget `bedrock-monthly` | $10 per month over the billing services `Amazon Bedrock`, `Amazon Bedrock Service`, and `Claude Haiku 4.5 (Amazon Bedrock Edition)`. Alerts at 50, 80, and 100 percent.                                                                    |
| Budget `scope-monthly`   | $5 per month over resources tagged `CostScope=portfolio-v2-prod`. Alerts at 50 and 80 percent. No action.                                                                                                                                  |
| Action                   | `APPLY_IAM_POLICY`, `AUTOMATIC`, on actual spend at 100 percent of `bedrock-monthly`. Attaches `portfolio-v2-prod-deny-model-invoke` to the listed roles.                                                                                  |
| Deny policy              | Denies `bedrock:InvokeModel`, `InvokeModelWithResponseStream`, `Converse`, `ConverseStream`, and `bedrock-mantle:*` on every resource. One policy covers both endpoint families, which corrects the original InvokeModel-only plan (R-03). |
| Execution role           | `portfolio-v2-prod-budget-action`, assumable only by AWS Budgets for budgets named `portfolio-v2-prod-*`. May attach or detach only that deny policy, only on the listed roles.                                                            |
| Target roles             | `portfolio-v2-prod-killswitch-probe` today. Phase 3 adds the API execution role to the same list.                                                                                                                                          |

The service budget deliberately over-approximates: other projects' Bedrock spend counts toward it (ADR-047). That fails safe, because the deny policy touches only portfolio-v2 roles.

### Fallback, designed but not built

If the native action ever proves unusable: budget notification, then SNS, then a small independent Lambda that calls `PutFunctionConcurrency(0)` on the API function. It stops the whole API, including admin paths, and in-flight requests finish. It is not built because the native action is supported and stored (below), and no API function exists until Phase 3.

## Drill, 2026-10-04

Run with the operator role assuming `portfolio-v2-prod-killswitch-probe`. The probe's credentials were issued **before** the deny policy was attached and reused throughout, to prove the policy affects sessions that already exist. Each poll made one tiny call per model.

| Step               | Observation                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline           | Titan returned a 512-element vector. Haiku answered once. Gemma answered.                                                                    |
| Attach deny policy | At +3 s and +8 s Titan and Gemma still succeeded. At **+13 s all three were refused**. Propagation therefore falls between 8 and 13 seconds. |
| Detach deny policy | Still refused at +3 s and +8 s. At **+13 s Titan and Gemma succeeded again**. Haiku passed authorization (see the caveat below).             |
| Final state        | No policies attached to the probe role.                                                                                                      |

Execution-role scope, checked with the IAM policy simulator: attach and detach of the deny policy on the probe role are allowed; the same on the operator role or another project's role, attaching any other policy, and creating a role are all implicitly denied. AWS Budgets stores the action as `APPLY_IAM_POLICY`, `AUTOMATIC`, `ACTUAL`, 100 percent, status `STANDBY`, target role the probe role.

### Caveats

- **Haiku could not be fully exercised.** After its first successful call, Haiku returned `ResourceNotFoundException: Model use case details have not been submitted for this account` on every call. Its denial is proven (it returned AccessDenied at +13 s). Its restoration is shown only indirectly: after the detach its error changed from AccessDenied to the use-case error, so IAM let the request through. One Haiku poll at +170 s was classified as denied and its cause was not captured. See [model-probe.md](model-probe.md).
- **The automatic trigger has not fired.** Reaching 100 percent needs real spend. Budgets are evaluated only a few times per day and billing data lags by up to a day, so the action can fire well after spend occurs. Spend can exceed the limit before it acts. Real-time quotas remain the primary cost defense; this switch is a backstop.
- **Gemma's billing service name is unknown** until billed usage exists, so the service budget may not count Gemma spend yet. Recheck after the first billed Gemma usage (P6-03).

## Recovery

1. Keep chat off: set `/portfolio-v2/prod/chat_enabled` to `false`.
2. Find the cause. The budget view shows which service drove the spend.
3. Detach the policy from each affected role: `aws iam detach-role-policy --role-name <role> --policy-arn <deny policy arn> --profile portfolio-v2`.
4. Verify with `aws iam list-attached-role-policies --role-name <role>`, wait about 15 seconds, and run one bounded call.
5. Restore chat only after the bounded test passes. Record the previous attachment state, the time, and the reason.

Other principals (the operator role, evaluation and ingestion roles) are not affected by this switch and need their own budget scope in Phases 5 and 6.
