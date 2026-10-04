#!/bin/bash
# Probe matrix for the OAC spike. Usage: probe.sh <cloudfront-domain> <function-url> <log-group>
# Prints PASS or FAIL per case. Never prints the token value.
set -u
DOMAIN="$1"; DIRECT="$2"; LOGGROUP="$3"
URL="https://${DOMAIN}/chat"
TOKEN="spike-jwt-$(date +%s)-NOT-A-REAL-TOKEN"
BODY='{"q":"hello"}'
HASH=$(printf '%s' "$BODY" | shasum -a 256 | cut -d' ' -f1)
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1  ($2)"; FAILED=1; }
FAILED=0
req() { # extra curl args; prints "<status> <ttfb> <total>" then the body on following lines
  curl -sS -N -o /tmp/oac.body -D /tmp/oac.head -w '%{http_code} %{time_starttransfer} %{time_total}' -X POST "$@" "$URL" -d "$BODY"
}

echo "== 1. good request streams through CloudFront"
read -r code ttfb total < <(req -H "content-type: application/json" -H "x-amz-content-sha256: $HASH" -H "X-Auth-Token: $TOKEN"; echo)
[ "$code" = "200" ] && pass "status 200" || fail "status 200" "got $code"
awk -v a="$ttfb" -v b="$total" 'BEGIN{exit !(b-a>1.0)}' && pass "streamed: first byte at ${ttfb}s, finished at ${total}s" || fail "streaming" "ttfb=$ttfb total=$total (buffered?)"
grep -q '"tokenHeaderPresent":true' /tmp/oac.body && pass "custom X-Auth-Token reached the origin" || fail "token forwarded" "$(head -c 200 /tmp/oac.body)"
grep -q '"hashHeaderMatchesBody":true' /tmp/oac.body && pass "payload hash header matches the body" || fail "hash matches" ""
grep -qi '^x-cache: Miss from cloudfront' /tmp/oac.head && pass "not cached (first request is a Miss)" || fail "first request Miss" "$(grep -i '^x-cache' /tmp/oac.head)"

echo "== 2. identical request again must not be served from cache"
read -r code ttfb total < <(req -H "x-amz-content-sha256: $HASH" -H "X-Auth-Token: $TOKEN"; echo)
grep -qi '^x-cache: Hit' /tmp/oac.head && fail "no caching" "got a cache hit" || pass "second request not a cache hit"

echo "== 3. missing payload hash is rejected"
read -r code _ _ < <(req -H "X-Auth-Token: $TOKEN"; echo)
[ "$code" != "200" ] && pass "rejected with $code" || fail "missing hash rejected" "got 200"

echo "== 4. wrong payload hash is rejected"
read -r code _ _ < <(req -H "x-amz-content-sha256: 0000000000000000000000000000000000000000000000000000000000000000" -H "X-Auth-Token: $TOKEN"; echo)
[ "$code" != "200" ] && pass "rejected with $code" || fail "wrong hash rejected" "got 200"

echo "== 5. direct origin access without a signature is denied"
dcode=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$DIRECT" -d "$BODY" -H "content-type: application/json")
[ "$dcode" = "403" ] && pass "direct call returned 403" || fail "direct denied" "got $dcode"

echo "== 6. a spoofed viewer Authorization header cannot take over the origin identity"
# The origin accepts only a valid SigV4 signature, so a forged header sent straight to it must fail (A).
# The same forged header sent through CloudFront succeeds only if CloudFront replaced it with its own signature (B),
# and CloudFront still enforces the payload hash (C).
acode=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$DIRECT" -d "$BODY" -H "Authorization: Bearer attacker-supplied" -H "x-amz-content-sha256: $HASH")
[ "$acode" = "403" ] && pass "A: forged Authorization sent directly to the origin returns 403" || fail "A: forged header rejected at origin" "got $acode"
read -r code _ _ < <(req -H "x-amz-content-sha256: $HASH" -H "X-Auth-Token: $TOKEN" -H "Authorization: Bearer attacker-supplied"; echo)
[ "$code" = "200" ] && pass "B: the same forged header through CloudFront returns 200, so CloudFront replaced it with its signature" || fail "B: spoof overridden" "got $code"
read -r code _ _ < <(req -H "x-amz-content-sha256: 0000000000000000000000000000000000000000000000000000000000000000" -H "X-Auth-Token: $TOKEN" -H "Authorization: Bearer attacker-supplied"; echo)
[ "$code" != "200" ] && pass "C: forged header plus wrong hash is still rejected ($code)" || fail "C: hash still enforced" "got 200"

echo "== 7. the token never appears in the function's logs"
sleep 20
hits=$(aws logs filter-log-events --log-group-name "$LOGGROUP" --filter-pattern "\"$TOKEN\"" --query 'length(events)' --output text 2>&1)
[ "$hits" = "0" ] && pass "0 log events contain the token" || fail "token absent from logs" "events=$hits"
rm -f /tmp/oac.body /tmp/oac.head
exit $FAILED
