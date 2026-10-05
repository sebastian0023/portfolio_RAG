# Initial abuse budgets and failure behavior

Covers P1-13. Every number here is **provisional**: it becomes the default of the `limits` SSM parameter (P1-07) and is revisited after P1-01 measures real usage and again in Phase 4. Related: ADR-016, 017, 024, 025, 026, 027, R-08, R-15.

## Cost assumptions

Reference prices are from the Notion pricing snapshot (2026-10-03) and are **not yet confirmed against billed usage**. P1-01 replaces them with measured values.

| Item                     | Reference rate                      |
| ------------------------ | ----------------------------------- |
| Haiku 4.5, US profile    | $1.10 / 1M input, $5.50 / 1M output |
| Gemma 4 26B-A4B          | $0.13 / 1M input, $0.40 / 1M output |
| Titan Text Embeddings v2 | $0.02 / 1M input tokens             |
| S3 Vectors query         | $2.50 / 1M queries plus data tiers  |

Worst-case cost of one admitted message at the caps below (6,000 input, 400 output tokens):

| Model | Generation | Embedding + retrieval | Per message    |
| ----- | ---------- | --------------------- | -------------- |
| Haiku | $0.0088    | under $0.00001        | about $0.0088  |
| Gemma | $0.00094   | under $0.00001        | about $0.00095 |

At the global quota of 50 messages per day for 30 days (1,500 messages), worst case is about $13.20 with Haiku and $1.43 with Gemma. The Bedrock monthly budget (the kill switch) is $15, which leaves $1.80 above the Haiku worst case (a contract test keeps the quota and the budget consistent). The worst case needs every message to use the full 6,000-token prompt, which only happens once retrieval exists (Phase 5); today's plain answers cost closer to $0.002, so about $3 a month at the full quota. Evaluation, judge, and ingestion spend are budgeted separately (Phases 5 and 6). The monthly budget is a lagging backstop, not a spending ceiling: the real-time controls are the quotas below.

## Request limits

| Control                     | Provisional value                 | Notes                                                        |
| --------------------------- | --------------------------------- | ------------------------------------------------------------ |
| Question length             | 500 characters                    | Rejected before any other work                               |
| Request body                | 8 KB                              | Includes history                                             |
| History                     | last 4 turns                      | Client-supplied history is untrusted and re-bounded          |
| Retrieved chunks            | 5 chunks, 800 tokens each         | Evidence is untrusted text in the prompt                     |
| Total prompt                | 6,000 tokens                      | Hard cap; PromptBuilder truncates evidence first             |
| Max output                  | 400 tokens                        | Must bound **all billed** output including reasoning (R-12)  |
| Lambda timeout              | 30 s                              | Also the model call deadline                                 |
| Lambda reserved concurrency | 5                                 | Caps parallel paid calls; also the emergency fallback target |
| Retries                     | 0 for generation, 1 for embedding | A retry is a second billed call; count it                    |

## Rate limits and quotas

Two stages, cheapest first (ADR-016). Windows are UTC calendar days, expressed in the counter key; DynamoDB TTL only deletes old items and is never trusted to expire a window (ADR-017).

| Stage    | Key                                       | Limit       | Runs before                      |
| -------- | ----------------------------------------- | ----------- | -------------------------------- |
| Pre-auth | trusted client IP, per minute             | 10 requests | The guest pass check             |
| Pre-auth | global, per minute                        | 40 requests | The guest pass check             |
| Quota    | guest (valid pass), per IP bucket per day | 10 messages | Embedding, retrieval, generation |
| Quota    | global per day, all visitors              | 50 messages | Embedding, retrieval, generation |

There are no accounts and no per-user quota (ADR-051). The IP bucket is an IPv4 address or an IPv6 /64, taken only from the trusted CloudFront-forwarded viewer address, never from a client-supplied header (R-15). An IPv6 host can rotate addresses inside its /64, so a narrower key would let it dodge the limit. A missing or ambiguous address refuses the request.

**Stage order**, cheapest first, nothing paid before the last stage: route and method, content type, byte cap (read at most 8 KB), JSON and schema, config load and limit re-check, trusted IP, per-IP and global per-minute rate (one atomic transaction, so a refused viewer does not use global capacity), `chat_enabled`, **index ready** (a 503 while `active_index` is `none`, before any pass check or quota use, ADR-054), **guest pass**, provider resolution, then the daily quota (reserved, never refunded), then retrieval (one embedding and one index query) and the model call. If nothing in the corpus clears the relevance threshold the model is not called at all; a failure in retrieval is a 503 before the answer begins. The guest pass is a signed one-hour proof that the visitor passed the Turnstile check, bound to their IP bucket (ADR-052); without a valid one the request is refused with `guest_check_failed` before any quota is used. `POST /api/guest-pass` runs the cheap stages first too, so Cloudflare is only called for a well-formed request that passed the rate limit. The client trims its own history to fit the byte cap before hashing, and the server re-bounds it to the last four turns and to alternating roles.

### Reservation semantics

1. The visitor's counter and the global counter are reserved in **one** DynamoDB transaction, each with a condition that the count is below its limit. Either both increment or neither does, so a visitor who is out of questions cannot burn site capacity. Which condition failed decides the refusal: `quota_exhausted` (the visitor's own) or `site_limit` (the site's).
2. Reservation happens before the first paid call and is never refunded. Aborted streams, client disconnects, model errors, and timeouts all stay counted.
3. Requests rejected before reservation (invalid input, failed auth) cost nothing and are limited only by the pre-auth stage.
4. Cancelling the stream aborts the model call, but the reservation stays.

## Fail-closed rules

Any of these must reject the request **before** a paid call, with no fallback to a default:

- `chat_enabled` is false, missing, or not a boolean (default is false, ADR-027).
- SSM config is missing, fails schema validation, or names an unknown provider or model. After the cache TTL (30 s) a failed refresh also rejects rather than reusing stale values.
- The counter store is unavailable or returns an unexpected response.
- The guest pass is missing, forged, expired, or from another network (`guest_check_failed`), or a guest-check secret is missing, unreadable, or still the placeholder. Turnstile verification is unavailable (timeout, outage, bad answer, wrong secret) or the trusted-IP lookup fails or is ambiguous.
- Retrieval or embedding fails: return an error, never an ungrounded answer from the model alone.

## Failure behavior the tests show

`apps/api/src/core/admission/cost-abuse.test.ts` (P4-06) runs the real stage chain and chat handler with a model that counts its calls. A mutation check (raising the per-IP limit by one) makes five of its cases fail. It covers:

- The 11th question from one visitor is `quota_exhausted`, and the 51st from a new visitor is `site_limit`; neither makes a model call.
- Concurrent requests at the limit admit exactly the remaining count (no overshoot), for one visitor and across the site.
- A visitor who is out of questions does not use up site capacity.
- Yesterday's questions do not count against today (the day is part of the key).
- Spoofed `X-Forwarded-For`, `X-Real-IP`, and `Authorization` do not change whose quota is used; a comma-separated viewer address is refused; another visitor's pass is refused.
- No pass, a forged pass, an expired pass, and garbage are all `guest_check_failed` with no quota or model use; a reused Turnstile token issues no pass.
- A disconnect after `accepted`, and a model that fails at once, both still count as a used question.
- A missing parameter, an invalid model config, unset or unreadable secrets, and an unreachable counter store each refuse before any paid call.
