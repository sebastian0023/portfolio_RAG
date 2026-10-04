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
grep -q '"authorizationIsSigV4":true' /tmp/oac.body && pass "origin saw a CloudFront SigV4 Authorization header" || fail "authorization is SigV4" "not seen by handler (Lambda may not pass it through)"
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
read -r code _ _ < <(req -H "x-amz-content-sha256: $HASH" -H "X-Auth-Token: $TOKEN" -H "Authorization: Bearer attacker-supplied"; echo)
if [ "$code" = "200" ] && grep -q '"authorizationIsSigV4":true' /tmp/oac.body; then pass "spoofed Authorization was replaced by CloudFront's signature"; else fail "spoof overridden" "status $code, $(head -c 160 /tmp/oac.body)"; fi

echo "== 7. the token never appears in the function's logs"
sleep 20
hits=$(aws logs filter-log-events --log-group-name "$LOGGROUP" --filter-pattern "\"$TOKEN\"" --query 'length(events)' --output text 2>&1)
[ "$hits" = "0" ] && pass "0 log events contain the token" || fail "token absent from logs" "events=$hits"
rm -f /tmp/oac.body /tmp/oac.head
exit $FAILED
