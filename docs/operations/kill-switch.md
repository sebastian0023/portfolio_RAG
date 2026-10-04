# Budget kill switch

Covers P1-08 and P1-09. Related: ADR-026, ADR-047, R-03, R-06, and the runbook entry "Budget or emergency kill switch" in the Notion plan.

## Design

| Piece                    | Detail                                                                                                                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Budget `bedrock-monthly` | $15 per month over the billing services `Amazon Bedrock`, `Amazon Bedrock Service`, and `Claude Haiku 4.5 (Amazon Bedrock Edition)`. Alerts at 50, 80, and 100 percent. Raised from $10 in Phase 4 so the site-wide daily quota of 50 at worst-case cost (about $13.20) fits (ADR-051). |
| Budget `scope-monthly`   | $5 per month over resources tagged `CostScope=portfolio-v2-prod`. Alerts at 50 and 80 percent. No action.                                                                                                                                                                               |
| Action                   | `APPLY_IAM_POLICY`, `AUTOMATIC`, on actual spend at 100 percent of `bedrock-monthly`. Attaches `portfolio-v2-prod-deny-model-invoke` to the listed roles.                                                                                                                               |
| Deny policy              | Denies `bedrock:InvokeModel`, `InvokeModelWithResponseStream`, `Converse`, `ConverseStream`, and `bedrock-mantle:*` on every resource. One policy covers both endpoint families, which corrects the original InvokeModel-only plan (R-03).                                              |
| Execution role           | `portfolio-v2-prod-budget-action`, assumable only by AWS Budgets for budgets named `portfolio-v2-prod-*`. May attach or detach only that deny policy, only on the listed roles.                                                                                                         |
| Target roles             | `portfolio-v2-prod-killswitch-probe` and, from Phase 3, the API execution role `portfolio-v2-prod-api`. The list is the module input `additional_kill_target_roles`, passed from the stack by name.                                                                                     |

The service budget deliberately over-approximates: other projects' Bedrock spend counts toward it (ADR-047). That fails safe, because the deny policy touches only portfolio-v2 roles.

### Fallback, designed but not built

If the native action ever proves unusable: budget notification, then SNS, then a small independent Lambda that calls `PutFunctionConcurrency(0)` on the API function. It stops the whole API, including admin paths, and in-flight requests finish. It is not built because the native action is supported and stored (below). The API function now exists (Phase 3), so the fallback can be built if the native action is ever judged insufficient.

## Drill, 2026-10-04

Run twice with the operator role assuming `portfolio-v2-prod-killswitch-probe`. The probe's credentials were issued **before** the deny policy was attached and reused throughout, to prove the policy affects sessions that already exist. Each poll made one tiny call per model, about five seconds apart, so every time below is accurate to roughly five seconds.

**Run 2 (Haiku working), the reference result:**

| Step               | Observation                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Baseline           | Titan, Haiku, and Gemma all succeeded. At +3 s after the attach they still did.                  |
| Attach deny policy | Gemma refused by **+8 s**. Titan and Haiku refused by **+13 s**. All three refused from then on. |
| Detach deny policy | All three refused at +3 s and +7 s. All three succeeded again at **+13 s**.                      |
| Final state        | No policies attached to the probe role.                                                          |

**Run 1 (earlier the same day):** Haiku was failing for an unrelated reason (the Anthropic use-case form had not been submitted), so its restoration could only be inferred from its error changing from AccessDenied to that form error. Titan and Gemma were refused by +13 s and restored at +13 s, matching run 2. One Haiku poll at +170 s was classified as denied and its cause was not captured; it did not recur in run 2.

Execution-role scope, checked with the IAM policy simulator: attach and detach of the deny policy on the probe role are allowed; the same on the operator role or another project's role, attaching any other policy, and creating a role are all implicitly denied. AWS Budgets stores the action as `APPLY_IAM_POLICY`, `AUTOMATIC`, `ACTUAL`, 100 percent, status `STANDBY`, target role the probe role.

### Caveats

- **The automatic trigger has not fired.** Reaching 100 percent needs real spend. Budgets are evaluated only a few times per day and billing data lags by up to a day, so the action can fire well after spend occurs. Spend can exceed the limit before it acts. Real-time quotas remain the primary cost defense; this switch is a backstop.
- **Gemma's billing service name is unknown** until billed usage exists, so the service budget may not count Gemma spend yet. Recheck after the first billed Gemma usage (P6-03).
- The drill proves the deny policy and its removal. It does not prove that AWS Budgets itself attaches the policy; that is exercised only when spend reaches the threshold.

## Recovery

1. Keep chat off: set `/portfolio-v2/prod/chat_enabled` to `false`.
2. Find the cause. The budget view shows which service drove the spend.
3. Detach the policy from each affected role: `aws iam detach-role-policy --role-name <role> --policy-arn <deny policy arn> --profile portfolio-v2`.
4. Verify with `aws iam list-attached-role-policies --role-name <role>`, wait about 15 seconds, and run one bounded call.
5. Restore chat only after the bounded test passes. Record the previous attachment state, the time, and the reason.

Other principals (the operator role, evaluation and ingestion roles) are not affected by this switch and need their own budget scope in Phases 5 and 6.

## Phase 3: the API role is a target

`portfolio-v2-prod-api` is a target, so the budget action attaches the same deny policy to it. The API treats the resulting `AccessDeniedException` as an outage: before an answer begins the visitor gets a plain `unavailable` refusal, mid-answer it is an interruption (ADR-049). To be recorded in the Phase 3 evidence once deployed:

1. Simulator check: the budget-action role may attach and detach the deny policy on `portfolio-v2-prod-api`, and is denied for the operator role and for any role outside the prefix.
2. Drill during a smoke window: attach the deny policy to the API role by hand, send one message, expect `unavailable` within about 15 seconds, detach, and expect answers again. Record the timings next to the table above.
