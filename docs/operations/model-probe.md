# Model, region, and vector store verification

Covers P1-01. Related: R-01, R-02, R-03, ADR-018, ADR-020, ADR-021. All calls ran in `us-east-1` as `portfolio-v2-prod-killswitch-probe` with temporary credentials from the MFA-gated operator role, on 2026-10-04.

## Results

| Item                     | Result                                                                                                                                                                                       | Status                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Titan Text Embeddings v2 | `amazon.titan-embed-text-v2:0` with `dimensions: 512` returned a 512-element vector for a one-word input (2 input tokens).                                                                   | Verified                           |
| Haiku 4.5, US profile    | `us.anthropic.claude-haiku-4-5-20251001-v1:0` through the Converse API answered once (14 input, 4 output tokens), then failed on every later call.                                           | **Blocked: account action needed** |
| Gemma 4 26B-A4B          | `google.gemma-4-26b-a4b` on the mantle endpoint answered (40 input, 2 output tokens) using SigV4 with the role's temporary credentials. No API key was used.                                 | Verified                           |
| S3 Vectors               | Vector bucket and a 512-dimension float32 cosine index created in us-east-1; one vector stored; a filtered query returned it with its metadata at distance 0; everything deleted afterwards. | Verified                           |

### Haiku blocker

Every call after the first returns `ResourceNotFoundException: Model use case details have not been submitted for this account. Fill out the Anthropic use case details form before using the model.` `get-foundation-model-availability` reports authorization `AUTHORIZED` and entitlement `AVAILABLE`, but agreement status `NOT_AVAILABLE`. The global profile fails the same way. The US profile routes across `us-east-1`, `us-east-2`, and `us-west-2`.

The account owner must submit the Anthropic use-case details in the Bedrock console (Model catalog, Anthropic). That is an attestation only the owner can make. It does not block Phase 1's exit, but Phase 3's Haiku adapter cannot be tested until it is done. Why the first call succeeded is unexplained.

### Gemma and Titan notes

- A one-line prompt cost Gemma 40 input tokens, about 30 more than the text itself, so its chat template adds a fixed overhead. Include it in cost estimates (P6-04).
- Gemma has no entry in the Service Quotas listing, and its billing service name is unknown until billed usage appears.
- The mantle request path that worked is `POST https://bedrock-mantle.us-east-1.api.aws/openai/v1/chat/completions`, signed with SigV4 service name `bedrock-mantle`.

### S3 Vectors limits observed

| Test                                          | Outcome                                                      |
| --------------------------------------------- | ------------------------------------------------------------ |
| 3,000 bytes in a filterable metadata value    | Rejected: `Filterable metadata must have at most 2048 bytes` |
| 30,000 bytes in a non-filterable metadata key | Accepted (total limit is documented as 40 KB)                |
| 3-element vector in a 512-dimension index     | Rejected: `vector must have length 512, but has length 3`    |

Ingestion must keep each filterable value well under 2 KB and put chunk text in a non-filterable key.

## Quotas that matter (shared account, ADR-047)

| Quota                                                  | Value                      | Implication                                                                                                                                              |
| ------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lambda concurrent executions, account                  | 1,000, with 998 unreserved | Reserving 5 for the API costs other projects almost nothing.                                                                                             |
| Haiku 4.5 cross-region requests per minute             | **50**                     | Below the planned global pre-auth cap of 60 per minute. The 30 admitted messages per day keep real traffic far under it, but a burst could be throttled. |
| Haiku 4.5 cross-region tokens per minute               | 5,000,000                  | Not a constraint.                                                                                                                                        |
| Titan Text Embeddings v2 on-demand requests per minute | 600                        | Not a constraint for queries; check it during ingestion in Phase 5.                                                                                      |

## Pricing evidence

No billed prices exist yet: Cost Explorer lags by up to a day. The reference prices in the pricing snapshot stand until then. A follow-up reads the billed usage for the Titan, Haiku, and Gemma calls above and compares it with the reference rates.

## Risk status

- R-01: Titan and Gemma verified; Haiku blocked by the use-case form.
- R-02: verified in us-east-1 for the 512-dimension cosine configuration and the metadata limits above. Price confirmation waits for billing data.
- R-03: confirmed. One deny policy refused runtime and mantle inference within 13 seconds ([kill-switch.md](kill-switch.md)).
