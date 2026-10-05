# Phase 4: Guest access and abuse protection

Status: Complete (deployed and tested from `dev`). The Notion mirror and the 24-hour cost check remain.

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

## Exit checklist

- [x] Exit criteria above met: a guest passed the real Turnstile check, asked questions, and was answered, deployed from `dev`
- [x] Lint, typecheck, formatting, and Vitest green locally (422 root tests, 177 Angular tests, 23 browser tests) and in CI on every Phase 4 pull request
- [x] Terraform fmt, validate, plan, the plan guard, and Checkov green in CI; a plan from `dev` after the apply reports no changes
- [x] Phase-specific acceptance, cost, and security checks recorded below (the 24-hour cost figure is still to come)
- [x] Post-deploy smoke passed (chat off, and the guest-pass window)
- [x] No secrets, private contact details, or confidential knowledge committed (the secret values exist only in SSM)
- [ ] ADR and risk changes mirrored in Notion (ADR-051, ADR-052, the ADR-049 update, R-05 and R-11 not applicable, R-18 addressed, P4-01, P4-02 and P4-05 cancelled). Owner or a session with Notion access.
- [x] PRs merged into `dev` and tagged `phase-4-complete`
- [ ] Notion phase set to Done (owner)

## Evidence

- Task PRs into the phase branch: #32 to #38. Consolidated PR into `dev`: [#39](https://github.com/sebastian0023/portfolio_RAG/pull/39). Follow-ups: #40 (runbook), #41 (production Turnstile sitekey). Each was green on `typescript`, `terraform`, `checkov`, `plan`, and `browser-smoke` before merging.
- Tag: [`phase-4-complete`](https://github.com/sebastian0023/portfolio_RAG/tree/phase-4-complete) on `687b6b9`, the `dev` merge commit that `version.json` names.
- Applied from `dev` with the MFA operator role: 2 resources added (the two SecureString placeholders) and 6 changed (the Lambda version and `live` alias, the API role policy, the Bedrock budget at $15, the CSP header policy, `limits` at 10 and 50). The plan had no deletes or replaces and the guard reported no violations. The bundle hash from `dev` matched the one CI built. A follow-up plan reports no changes.
- Web deploy: `deploy-web.ts` from `687b6b9` published 44 files and invalidated `/index.html` and `/version.json`; the sitekey is in the deployed bundle.
- Smoke, chat off (from `dev`): every check passed, including the new CSP header, the guest-pass route (503 with chat off, 405 on OPTIONS with no CORS), the first 10 requests of a minute admitted and the 11th and 12th rate limited with `Retry-After`.
- Secrets: both were set out of band after the apply (verified only as "not the placeholder"; values never printed).
- Bounded chat window (one window, then `chat_enabled` set back to `false`): `smoke-edge.ts --window` passed all five checks: chat without a pass is 403, a forged pass is 403, a bogus Turnstile token is refused by Cloudflare (403, which also proves the API can decrypt and use both secrets), the guest-pass answer is uncached JSON, and a malformed body is 400. In a real browser the owner passed the bot check and got answers ("it works well"); the exact quota counter text and the Stop button were not recorded.
- Window closed and verified: `chat_enabled` is `false`, the API role has no attached policies, the chat-off smoke passes again, and a plan reports no changes.
- Earlier observation: the first window attempt failed because the secrets were still the placeholder; a bad deploy was not the cause. The runbook ([phase-4-finish.md](../operations/phase-4-finish.md)) now explains that case.
- Not recorded: the cost after 24 hours (Cost Explorer by `CostScope`), the rollback rehearsal, and the browser counter text.
- Sign-off: owner confirmed the browser test works on 2026-10-04.

Sign-off and detailed results are tracked in the [Notion plan](https://app.notion.com/p/3efc9c3293d981c4ab1bcf5e2dad3d55).
