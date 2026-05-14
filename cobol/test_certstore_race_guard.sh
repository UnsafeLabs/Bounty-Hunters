#!/usr/bin/env bash
set -euo pipefail

src="${1:-cobol/TLS-CERT-VALIDATOR.cbl}"

require() {
  local pattern="$1"
  local message="$2"
  if ! grep -Eq "$pattern" "$src"; then
    echo "FAIL: $message" >&2
    exit 1
  fi
  echo "PASS: $message"
}

require "OPEN[[:space:]]+I-O[[:space:]]+CERT-STORE-FILE" \
  "trust store is opened for serialized read/rewrite"
require "EXEC CICS HANDLE CONDITION" \
  "CICS HANDLE CONDITION is installed"
require "DSIDERR\\(1010-CERTSTORE-DSIDERR\\)" \
  "DSIDERR routes to a cert-store failure handler"
require "EXEC CICS ENQ" \
  "CERTSTOR ENQ protects the critical section"
require "RESOURCE\\('CERTSTOR'\\)" \
  "ENQ/DEQ use the CERTSTOR resource name"
require "LENGTH\\(8\\)" \
  "ENQ/DEQ use the required eight-byte resource length"
require "EXEC CICS DEQ" \
  "CERTSTOR DEQ releases the critical section"
require "EXEC CICS DELAY" \
  "retry path uses CICS DELAY"
require "MILLISECS\\(WS-CERTSTORE-DELAY-MS\\)" \
  "retry delay is configured in milliseconds"
require "WS-CERTSTORE-DELAY-MS[[:space:]]+PIC[[:space:]]+S9\\(8\\)[[:space:]]+COMP[[:space:]]+VALUE[[:space:]]+100" \
  "retry delay is 100 ms"
require "WS-CERTSTORE-MAX-RETRIES[[:space:]]+PIC[[:space:]]+9[[:space:]]+VALUE[[:space:]]+3" \
  "retry limit is three attempts"
require "VALUE '92'" \
  "FILE STATUS 92 is handled explicitly"
require "VALUE '93'" \
  "FILE STATUS 93 is handled explicitly"
require "VALUE '95'" \
  "FILE STATUS 95 is handled explicitly"
require "REWRITE[[:space:]]+CERT-STORE-RECORD" \
  "trust-store update uses REWRITE inside the guarded section"
require "CS-LAST-VALIDATED" \
  "successful validation updates the last-validated timestamp"
require "SET[[:space:]]+WS-CHAIN-IS-INVALID[[:space:]]+TO[[:space:]]+TRUE" \
  "trust-store failures fail closed"

if awk '
  /1000-INITIALIZE\./ { in_init = 1 }
  /1010-CERTSTORE-DSIDERR\./ { in_init = 0 }
  in_init && /SET[[:space:]]+WS-CHAIN-IS-VALID[[:space:]]+TO[[:space:]]+TRUE/ { bad = 1 }
  END { exit bad ? 0 : 1 }
' "$src"; then
  echo "FAIL: initialize path must not mark chain valid before trust-store work" >&2
  exit 1
fi
echo "PASS: initialize path starts fail-closed"

echo "All CERTSTOR race guard checks passed."
