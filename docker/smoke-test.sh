#!/usr/bin/env bash
# Starts the whole app with Docker Compose, checks it through nginx, and
# shuts it down, removing its volumes (printing the container logs first
# if a check failed).
# CI's DockerSmokeTest job runs this; locally: bash docker/smoke-test.sh
# Needs VENDOR_API_KEY in the shell or the repo-root .env.

set -euo pipefail
cd "$(dirname "$0")/.."

BASE=http://localhost:8080
QUOTE='{"loanAmount":"250000","loanTermInMonths":36,"riskBand":"MEDIUM"}'
WORK=$(mktemp -d)

# No simulated failures or hangs unless a check turns them on.
export VENDOR_FAILURE_RATE=0 VENDOR_TIMEOUT_RATE=0

finish() {
  local status=$?
  if [ "$status" -ne 0 ]; then docker compose logs || true; fi
  docker compose down --volumes >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit "$status"
}
trap finish EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}
pass() { echo "ok - $*"; }

# GET or POST through nginx; saves headers and body, prints "<status> <seconds>".
request() {
  local path=$1 body=${2:-}
  # The trailing \n matters: without it `read` hits end-of-input and fails under set -e.
  local args=(-sS -D "$WORK/headers" -o "$WORK/body" -w '%{http_code} %{time_total}\n')
  if [ -n "$body" ]; then args+=(-H 'content-type: application/json' -d "$body"); fi
  curl "${args[@]}" "$BASE$path"
}
header() { tr -d '\r' <"$WORK/headers" | grep -i "^$1:" | cut -d' ' -f2-; }

# POSTs a quote straight to vendor-api from inside its container (it isn't
# published), with a fixed Idempotency-Key; prints the quote's ID.
vendor_quote_id() {
  docker compose exec -T vendor-api sh -c 'wget -qO- --header "content-type: application/json" \
    --header "api-key: $VENDOR_API_KEY" --header "idempotency-key: smoke-restart" \
    --post-data "$1" http://127.0.0.1:4001/quotes' sh "$QUOTE" | grep -o '"quoteId":"[^"]*"'
}

docker compose up --build --detach --wait

# --- front end ---
curl -sS --retry 5 --retry-connrefused -o /dev/null "$BASE/"
read -r status _ < <(request /)
[ "$status" = 200 ] || fail "page returned $status"
grep -q '<div id="root">' "$WORK/body" || fail "page has no app root"
[ "$(header x-content-type-options)" = nosniff ] || fail "page lacks X-Content-Type-Options: nosniff"
[ "$(header referrer-policy)" = same-origin ] || fail "page lacks Referrer-Policy: same-origin"
[ "$(header cache-control)" = no-cache ] || fail "page should not be cached"
pass "page served with security headers, not cached"

asset=$(grep -oE '/assets/[^"]+\.js' "$WORK/body" | head -1)
read -r status _ < <(request "$asset")
[ "$status" = 200 ] || fail "asset $asset returned $status"
header cache-control | grep -q immutable || fail "fingerprinted asset is not cached long-term"
pass "fingerprinted assets cached long-term"

read -r status _ < <(request /some/deep/link)
[ "$status" = 200 ] && grep -q '<div id="root">' "$WORK/body" || fail "deep link didn't fall back to the app"
pass "deep links fall back to the app"

# --- API through nginx -> quote-service -> vendor-api ---
read -r status _ < <(request /api/quotes "$QUOTE")
[ "$status" = 200 ] || fail "quote returned $status: $(cat "$WORK/body")"
grep -q '"totalCommission":"8750.00"' "$WORK/body" || fail "unexpected quote: $(cat "$WORK/body")"
[ -n "$(header x-request-id)" ] || fail "quote response has no x-request-id"
pass "quote returned with a request ID"

read -r status _ < <(request /api/quotes '{"loanAmount":"-1","loanTermInMonths":36,"riskBand":"MEDIUM"}')
[ "$status" = 400 ] || fail "invalid quote returned $status"
grep -q '"code":"VALIDATION_ERROR"' "$WORK/body" && grep -q '"requestId"' "$WORK/body" ||
  fail "unexpected validation error: $(cat "$WORK/body")"
pass "invalid input rejected with a request ID"

for port in 4000 4001; do
  if curl -s -m 2 -o /dev/null "http://localhost:$port/healthz"; then fail "backend port $port is reachable from the host"; fi
done
pass "backends not reachable from the host"

# --- vendor keeps issued quotes on its volume across a new container ---
before=$(vendor_quote_id) || fail "vendor didn't issue a quote"
docker compose up --detach --wait --force-recreate vendor-api
after=$(vendor_quote_id) || fail "vendor didn't answer after being recreated"
[ "$after" = "$before" ] || fail "replayed key got $after after a restart, not $before"
pass "vendor returns the original quote for a key after a restart"

# --- vendor never responds: nginx must wait out quote-service's 8s deadline ---
VENDOR_TIMEOUT_RATE=1 docker compose up --detach --wait vendor-api
read -r status seconds < <(request /api/quotes "$QUOTE")
[ "$status" = 504 ] || fail "hanging vendor gave $status, expected 504: $(cat "$WORK/body")"
grep -q '"code":"VENDOR_TIMEOUT"' "$WORK/body" || fail "unexpected timeout body: $(cat "$WORK/body")"
awk -v s="$seconds" 'BEGIN { exit !(s >= 7) }' || fail "504 after ${seconds}s; nginx cut off quote-service's 8s deadline"
pass "hanging vendor gives 504 VENDOR_TIMEOUT after ${seconds}s"

echo "All Docker smoke checks passed."
