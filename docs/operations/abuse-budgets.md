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

At the global cap of 30 messages per day for 30 days (900 messages), worst case is about $7.92 with Haiku and $0.86 with Gemma. Against the draft USD 15 per month backstop (O-17) that leaves about $7 for fixed charges, retries, and billed reasoning tokens. Evaluation, judge, and ingestion spend are budgeted separately (Phases 5 and 6). The monthly budget is a lagging backstop, not a spending ceiling: the real-time controls are the quotas below.

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

| Stage    | Key                                        | Provisional limit | Runs before                      |
| -------- | ------------------------------------------ | ----------------- | -------------------------------- |
| Pre-auth | trusted client IP, per minute              | 10 requests       | JWT or Turnstile check           |
| Pre-auth | global, per minute                         | 60 requests       | JWT or Turnstile check           |
| Quota    | guest (verified Turnstile), per IP per day | 3 messages        | Embedding, retrieval, generation |
| Quota    | signed-in user (verified `sub`), per day   | 10 messages       | Embedding, retrieval, generation |
| Quota    | global per day, guests and users combined  | 30 messages       | Embedding, retrieval, generation |

The IP is taken only from the trusted CloudFront-forwarded viewer address, never from a client-supplied header. A JWT `sub` is used as a quota key only after the token is fully verified (R-15).

### Reservation semantics

1. The principal counter and the global counter are reserved in **one** DynamoDB transaction, each with a condition that the count is below its limit. Either both increment or neither does, so a rejected principal cannot burn global quota.
2. Reservation happens before the first paid call and is never refunded. Aborted streams, client disconnects, model errors, and timeouts all stay counted.
3. Requests rejected before reservation (invalid input, failed auth) cost nothing and are limited only by the pre-auth stage.
4. Cancelling the stream aborts the model call, but the reservation stays.

## Fail-closed rules

Any of these must reject the request **before** a paid call, with no fallback to a default:

- `chat_enabled` is false, missing, or not a boolean (default is false, ADR-027).
- SSM config is missing, fails schema validation, or names an unknown provider or model. After the cache TTL (30 s) a failed refresh also rejects rather than reusing stale values.
- The counter store is unavailable or returns an unexpected response.
- JWT verification, Turnstile verification, or the trusted-IP lookup fails or is ambiguous.
- Retrieval or embedding fails: return an error, never an ungrounded answer from the model alone.

## Failure behavior the tests must show

These become Phase 3 and 4 test cases (P4-06 cost-abuse suite):

- 31st message in a day returns a quota error and makes no model call.
- Concurrent requests at the limit admit exactly the remaining count (no overshoot).
- Spoofed `X-Forwarded-For` or `Authorization` values do not change the quota key.
- Disconnect mid-stream leaves the reservation counted.
- A missing parameter, bad value, or unreachable counter store rejects instead of answering.
