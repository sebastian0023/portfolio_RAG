# Finishing Phase 4: the owner steps

Written for the repository owner. Phase 4 (guests only, a Turnstile bot check, a one-hour guest pass, and 10 per IP and 50 per site daily quotas) is merged to `dev` and applied to AWS. These are the steps that only the owner can do, with the reason for each. Related: [ADR-051](../adr/adr-051.md), [ADR-052](../adr/adr-052.md), [Applying infrastructure](apply-procedure.md), the [Phase 4 doc](../phases/4-auth-abuse-protection.md).

## Where things stand (2026-10-04)

| Item                                                                                      | State                                                                  |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Code merged to `dev`                                                                      | Yes (merge commit `bfa16ff`), CI green                                 |
| Stack applied from `dev` (new Lambda version, limits 10 and 50, budget $15, CSP, secrets) | Yes; a follow-up `terraform plan` reports no changes                   |
| `turnstile_secret` and `guest_pass_key` in SSM                                            | Created, still the placeholder `unset`, so the API refuses all chat    |
| `chat_enabled`                                                                            | `false`                                                                |
| Web app on the live site                                                                  | Still the Phase 3 build (`b55f98b`); the Phase 4 build is not deployed |
| Turnstile sitekey in `apps/web/src/environments/environment.ts`                           | Empty, so `deploy-web.ts` refuses to publish                           |
| Chat-off smoke against the applied stack                                                  | All checks passed                                                      |
| Tag `phase-4-complete`                                                                    | Not pushed (only after the steps below)                                |

Until the steps below are done, visitors still get the Phase 3 site, and chat cannot be used. Nothing is broken or costing money.

## Step 1: create the Turnstile widget

**Why:** Turnstile is the bot check. Cloudflare issues a public **sitekey** for the browser and a private **secret key** for the server. A script cannot get a valid token without the widget, which is what stops bots from spending the daily quota.

1. Sign in at dash.cloudflare.com (a free account is enough) and open **Turnstile**.
2. **Add widget.** Name `portfolio`. Hostname `d3g60gipskhnei.cloudfront.net` (no `https://`, no path). Mode **Managed**.
3. Create it and note the **Site Key** (public) and the **Secret Key** (private).

If the site later gets a custom domain, add it as another hostname on the same widget (the free plan allows ten).

## Step 2: put the sitekey in the build and deploy

**Why:** the web app needs the public sitekey compiled in to show the widget. `deploy-web.ts` refuses to publish a build without it, because a page whose bot check cannot pass would lock every visitor out.

1. Set `turnstileSiteKey` in `apps/web/src/environments/environment.ts` to the Site Key (a value starting `0x`). It is public by design and is safe to commit. Open a pull request into `dev` and merge it once CI is green.
2. With an MFA session (`aws sts get-caller-identity --profile portfolio-v2`), from `dev`:
   ```sh
   git checkout dev && git pull --ff-only
   eval "$(aws configure export-credentials --profile portfolio-v2 --format env)"
   export AWS_REGION=us-east-1
   node infra/scripts/deploy-web.ts --dry-run   # read the upload list first
   node infra/scripts/deploy-web.ts
   node infra/scripts/smoke-edge.ts             # chat off; every check must PASS
   ```
   `version.json` in the smoke output should now name the new commit.

## Step 3: store the two secrets

**Why:** the API needs the Cloudflare secret to check tokens with Cloudflare, and a random key to sign guest passes. Both are the placeholder `unset`, so the API refuses every request. They are set by hand so the values never enter Terraform state, a plan, or Git (R-18).

```sh
eval "$(aws configure export-credentials --profile portfolio-v2 --format env)"
export AWS_REGION=us-east-1

read -rs TS && aws ssm put-parameter --name /portfolio-v2/prod/turnstile_secret --type SecureString --value "$TS" --overwrite; unset TS
aws ssm put-parameter --name /portfolio-v2/prod/guest_pass_key --type SecureString --value "$(openssl rand -base64 48)" --overwrite
```

`read -rs` prompts for the Secret Key: paste it there. Typing is hidden and it stays out of your shell history.

Confirm both are set without printing them. Each line must say `True`:

```sh
for n in turnstile_secret guest_pass_key; do aws ssm get-parameter --name /portfolio-v2/prod/$n --with-decryption --query 'Parameter.Value != `unset`' --output text; done
```

Then wait about **5 minutes**: the API caches the secrets that long. Rotating `guest_pass_key` later invalidates every pass; visitors simply pass the check again.

## Step 4: the bounded chat window

**Why:** this is the first real test of Turnstile, Cloudflare's server check, and the API reading the encrypted secrets, none of which can be tested with chat off. A real answer costs under a cent. Do not leave the window open.

```sh
aws ssm put-parameter --name /portfolio-v2/prod/chat_enabled --value true --type String --overwrite
sleep 35
node infra/scripts/smoke-edge.ts --window
```

`--window` makes no model call. It checks that chat without a pass is 403, a forged pass is 403, a bogus Turnstile token is refused by Cloudflare (403), the guest-pass answer is uncached JSON, and a malformed body is 400.

Then in a real browser open the site (`terraform -chdir=infra/stack output site_url`):

- Ask a general question such as "What is TypeScript?". The bot check runs (usually invisibly) and the answer streams in.
- The quota line reads **9 of 10 questions left today**.
- Ask a second question: it sends without running the check again.
- Optional: try Stop mid-answer.

**Close the window immediately**, whatever happened, and confirm:

```sh
aws ssm put-parameter --name /portfolio-v2/prod/chat_enabled --value false --type String --overwrite
aws ssm get-parameter --name /portfolio-v2/prod/chat_enabled --query Parameter.Value --output text   # must print: false
```

### If something fails

| Symptom                                                              | Likely cause                                                                                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `--window` bogus-token check answers **503** instead of 403          | A secret is still the placeholder, was set less than 5 minutes ago, or the API cannot decrypt it (see below)                                 |
| Browser says "Couldn't verify you" every time                        | Wrong or empty sitekey in the build, the hostname missing from the widget, or a blocked `challenges.cloudflare.com`                          |
| Browser console shows a CSP violation                                | The deployed CSP does not allow `https://challenges.cloudflare.com` in `script-src` and `frame-src` (it should; the smoke checks the header) |
| Answer works but the second question runs the check again            | The pass is not being kept or sent; send the browser's network tab for `/api/chat` (`x-auth-token`)                                          |
| `403 guest_check_failed` on the chat request after a pass was issued | The pass was bound to a different IP bucket (a VPN or network change), or the key was rotated: reload and retry                              |

If the 503 persists after 5 minutes, the API role may be unable to decrypt the SecureStrings with the AWS-managed SSM key. The key policy normally allows it through SSM; if it does not, add a scoped `kms:Decrypt` to the `api` module's policy with a `kms:ViaService` condition for `ssm.us-east-1.amazonaws.com`, as a pull request.

## Step 5: record the evidence and finish

This part is mechanical and can be done in a new session. Give it the output of step 4 and ask it to:

1. Record the deployment and smoke evidence in `docs/phases/4-auth-abuse-protection.md` (the deployed commit, the chat-off smoke, the `--window` output, and the browser result), and tick the exit checklist.
2. Push the tag `phase-4-complete` on the `dev` merge commit that was deployed (the one named by `version.json`).
3. Mirror in Notion: ADR-051 and ADR-052, the ADR-049 update, R-05 and R-11 as not applicable, R-18 as addressed, tasks P4-01, P4-02 and P4-05 as cancelled, and the phase set to Done. (Notion needs your access; Claude Code in this repository cannot reach it.)
4. Check Cost Explorer filtered by `CostScope=portfolio-v2-prod` a day later. The Bedrock spend for the window should be well under a dollar.

## Quick reference

- Limits: 10 questions per visitor IP per day, 50 per site per day, 10 requests per minute per IP, 40 per minute for the whole site (`/portfolio-v2/prod/limits`).
- Kill switch: `chat_enabled` false stops all answers within about 35 seconds; the Bedrock budget ($15 a month) detaches model access automatically at 100 percent ([kill-switch.md](kill-switch.md)).
- Secrets live only in SSM. Never paste the Turnstile secret into a chat, an issue, or a commit.
