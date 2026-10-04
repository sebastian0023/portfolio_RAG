# CloudFront OAC streaming spike

Covers P1-10 and risk R-04. Code: `infra/spikes/oac-stream` (a throwaway root with its own state key). Run on 2026-10-04 in `us-east-1`, then destroyed; nothing from the spike remains in AWS.

## What was built

A Node 22 ARM64 Lambda with a Function URL (`AWS_IAM`, `RESPONSE_STREAM`) behind a CloudFront distribution. The distribution uses an origin access control with `signing_behavior = always` and `origin type = lambda`, the managed `CachingDisabled` cache policy, all HTTP methods, and an origin request policy that forwards only `X-Auth-Token`. CloudFront was given both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` on the function. The handler streams five chunks 400 ms apart and reports facts about the request (token present, body size, whether the payload hash header matches the body) without logging or returning any header value.

## Result: all 14 probe assertions passed

| Case                                                                   | Outcome                                                                                               |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| POST with a correct `x-amz-content-sha256` and a custom `X-Auth-Token` | 200; first byte at 0.92 s, finished at 2.82 s, so the stream is delivered incrementally, not buffered |
| Custom `X-Auth-Token` at the origin                                    | Present                                                                                               |
| Payload hash header at the origin                                      | Matches the body                                                                                      |
| Same request twice                                                     | Both `Miss from cloudfront`; nothing cached                                                           |
| Missing payload hash                                                   | 403                                                                                                   |
| Wrong payload hash                                                     | 403                                                                                                   |
| Direct call to the Function URL, unsigned                              | 403                                                                                                   |
| Forged `Authorization: Bearer ...` sent directly to the Function URL   | 403                                                                                                   |
| The same forged header through CloudFront with a valid hash            | 200, so CloudFront replaced it with its own SigV4 signature                                           |
| Forged header through CloudFront with a wrong hash                     | 403                                                                                                   |
| Function logs, searched for the token value                            | 0 events                                                                                              |

Timing: the distribution deployed in about 2.5 minutes and took about 3 minutes to delete.

## Findings that change the design

1. **`x-amz-content-sha256` cannot be listed in an origin request policy.** CloudFront rejects it: `The parameter Headers contains x-amz-content-sha256 that is not allowed.` The viewer sends the header to CloudFront and CloudFront uses it when signing the origin request, so only `X-Auth-Token` is forwarded. The earlier plan to "forward `x-amz-content-sha256`" was wrong.
2. **The SPA must hash the exact bytes it sends** and set that header on every POST. A missing or wrong hash is rejected with 403.
3. **The Lambda event does not include the `Authorization` header.** Identity cannot be checked by inspecting it in the handler. The proof is behavioral: the origin rejects any unsigned or forged call (403), while the same forged header via CloudFront succeeds because CloudFront replaces it. Application authentication therefore must not rely on `Authorization`; it uses `X-Auth-Token` (ADR-015).
4. The handler never logs headers, which is what keeps the token out of logs. Enabling CloudFront access logs or any request logging later must exclude that header.

## Not tested

Custom domains and certificates; CORS preflight (`OPTIONS`); a stream that exceeds the 60-second origin read timeout; large request or response bodies; cold-start behavior beyond the first request; and whether each of the two Lambda permissions is individually required (both were granted). Phase 3 covers these in the real edge module.
