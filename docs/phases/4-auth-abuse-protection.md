# Phase 4: Guest access and abuse protection

Status: In progress. The code, tests, Terraform, and runbooks are complete on the phase branch. Nothing is applied or deployed yet; the owner-run steps below remain.

Branch: `phase/4-auth-abuse-protection` (the branch name keeps the original title)

## Goal

Safely enable anonymous traffic: a bot check, per-visitor and site-wide daily limits, and cost-abuse tests. There are no accounts (ADR-051).

## What changed from the original plan

The original goal was "anonymous and authenticated traffic" with Cognito, JWT verification, and an MFA-protected admin path. The owner decided a portfolio does not need accounts, so Cognito, the JWT middleware, the sign-in UI, and the admin API are not built. Tasks P4-01, P4-02, and P4-05 are cancelled; R-05 and R-11 no longer apply. Admin actions stay operator-run through the MFA-gated AWS role.

## Deliverables

Turnstile server verification and a signed one-hour guest pass; per-IP (10) and site-wide (50) daily quotas; the two secrets as SSM SecureStrings; removal of the sign-in code and the `user` principal; the cost-abuse suite; runbooks.

## Exit criteria

A guest can pass the bot check, ask questions up to their limit, and is refused cleanly after it; the site-wide limit holds; cost-abuse tests pass; deployed from `dev`.

## Tasks

Acceptance criteria and owners live in the [Tasks database](https://app.notion.com/p/71e03c7833164fd282ad6c0e23b49d1d).

| ID                                                                 | Task                                                   | Status                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------- |
| [P4-01](https://app.notion.com/p/3efc9c3293d9815ca813ccb9d8d5e658) | Provision protected Cognito pool and social app client | Cancelled (ADR-051)                            |
| [P4-02](https://app.notion.com/p/3efc9c3293d981618936c73a5a6c539f) | Implement SPA auth and strict JWT middleware           | Cancelled; the sign-in code is removed instead |
| [P4-03](https://app.notion.com/p/3efc9c3293d981c09a83d1de9960efdf) | Add Turnstile server verification and guest UX         | Built (ADR-052)                                |
| [P4-04](https://app.notion.com/p/3efc9c3293d981b4b74ad22f9c6c7498) | Implement atomic guest/user/global quotas              | Built as per-IP and global (ADR-051)           |
| [P4-05](https://app.notion.com/p/3efc9c3293d981bda3f6fd654d915f14) | Implement admin authorization with enforced MFA        | Cancelled; admin stays operator-run            |
| [P4-06](https://app.notion.com/p/3efc9c3293d981058c89e0e6ae8f957c) | Wire chat_enabled and cost-abuse failure cases         | Built (`cost-abuse.test.ts`, 24 cases)         |
| [P4-07](https://app.notion.com/p/3efc9c3293d9812a88d7d2656167b59a) | Complete the guest journey and abuse-gate phase PR     | Owner-run steps below                          |

## What is built

| Area     | Result                                                                                                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract | `QuotaState` is `{left, limit}`; `auth_expired` and the `user` principal are gone. New `GUEST_PASS_PATH`, `AUTH_HEADER`, and the guest-pass response schema.                                                                                          |
| Web      | Sign-in removed. Guest limit 10. A Turnstile adapter (invisible unless Cloudflare needs the visitor) trades a token for a pass, kept in memory; the transport sends it in `X-Auth-Token`. The check runs again only when the pass is gone or refused. |
| API      | `POST /api/guest-pass`; HMAC-signed pass bound to the IP bucket; `guestPassStage`; `guestQuotaStage` (one transaction over the visitor and site counters, then a consistent read for `accepted.quota`); secrets cache; siteverify client.             |
| Infra    | Limits 10 and 50, `userPerDay` removed; `turnstile_secret` and `guest_pass_key` SecureStrings created with the placeholder; Bedrock budget $15; `dynamodb:GetItem` for the API role.                                                                  |
| Edge     | CSP allows `https://challenges.cloudflare.com` in `script-src` and `frame-src` and nowhere else; the contract test pins both.                                                                                                                         |
| Tests    | 398 root tests, 177 Angular tests, 6 mocked and 17 production-build browser tests (zero CSP violations with Turnstile stubbed from its real origin).                                                                                                  |

## Risks and spikes

- [R-08](https://app.notion.com/p/3efc9c3293d981c9a2bac7ac1e68fdd9) — Token and request-cost abuse (Risk, Critical): addressed by the quotas, the pass, and the cost-abuse suite.
- [R-10](https://app.notion.com/p/3efc9c3293d9818a9d0fc207f12d3107) — Production-only blast radius (Risk, Critical)
- [R-15](https://app.notion.com/p/3efc9c3293d9818b871ac491e12e77ef) — Counter identity spoofing, TTL delay, and races (Risk, High): the key is the trusted viewer address only; keys carry the day; covered by the suite.
- [R-18](https://app.notion.com/p/3efc9c3293d981a7b47ce16e48765e34) — Secret values and rollback state leak through Terraform (Risk, High): placeholder plus `ignore_changes`; the owner sets the real values.
- R-05 (Cognito pricing) and R-11 (social-only admin MFA): not applicable (ADR-051).

## Owner-run steps

Each follows [Applying infrastructure](../operations/apply-procedure.md) and needs the owner's explicit go-ahead.

1. **Create the Turnstile widget** in the Cloudflare dashboard (Turnstile, Add widget): mode **Managed**, hostname the CloudFront domain (`terraform output site_url`, without `https://`). Keep the **sitekey** (public) and the **secret key**.
2. **Put the sitekey in the build:** set `turnstileSiteKey` in `apps/web/src/environments/environment.ts` (a pull request). `deploy-web.ts` refuses to publish while it is empty.
3. Merge the task pull requests into the phase branch in order.
4. **Apply `infra/stack`.** The plan creates the two SecureStrings, updates `limits`, the budget, and the API role policy, and destroys nothing. Then set the real secret values (the runbook has the commands; `read -s` keeps them out of shell history).
5. `deploy-web.ts`, then `smoke-edge.ts` (chat off).
6. **One bounded window** (`chat_enabled` true): `smoke-edge.ts --window`; then in a real browser pass the bot check, ask a question, and watch the quota line count down from 10; close the window and verify `chat_enabled` is `false`.
7. Phase pull request into `dev`; repeat the apply (no changes), deploy, and smoke from `dev`; tag `phase-4-complete`; mirror ADR-051 and ADR-052 and the risk updates in Notion.

## Exit checklist

- [ ] Exit criteria above met (deployed from `dev`; a guest answered through the real bot check)
- [x] Lint, typecheck, formatting, and Vitest green locally (398 root tests, 177 Angular tests, 23 browser tests). CI to confirm on each pull request.
- [x] Terraform fmt and validate green locally, Checkov green locally (every skip justified). CI plan to confirm.
- [ ] Phase-specific acceptance, cost, and security checks recorded (smoke runs, the browser journey, cost after 24 hours)
- [ ] Post-deploy smoke passed
- [x] No secrets, private contact details, or confidential knowledge committed (secret values exist only in SSM)
- [ ] ADR and risk changes mirrored in Notion and `docs/` (ADR-051 and ADR-052 are in `docs/`; Notion mirror pending)
- [ ] PR merged into `dev`, tagged `phase-4-complete`, Notion phase set to Done

## Evidence

- PR:
- Tag: `phase-4-complete`
- CI run:
- Deployment/smoke:
- Sign-off:

Sign-off and detailed results are tracked in the [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55).
