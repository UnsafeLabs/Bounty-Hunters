#!/usr/bin/env bash
set -euo pipefail

source_file="${1:-cobol/TLS-CERT-VALIDATOR.cbl}"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

grep -q "IF WS-CHAIN-LENGTH > 0" "$source_file" \
  || fail "missing zero-length guard before chain iteration"

grep -q "UNTIL WS-CHAIN-INDEX > WS-CHAIN-LENGTH" "$source_file" \
  || fail "missing bounded chain loop"

if grep -q "UNTIL WS-CHAIN-INDEX > WS-CHAIN-LENGTH + 1" "$source_file"; then
  fail "chain loop still indexes one entry past WS-CHAIN-LENGTH"
fi

grep -q "2100-VALIDATE-SELF-SIGNED-CERT" "$source_file" \
  || fail "missing empty-chain self-signed validation path"

grep -q "TLSVAL-W012: EMPTY CERT CHAIN" "$source_file" \
  || fail "missing empty-chain audit display"

grep -q "SELF-SIGNED CERTIFICATE NOT TRUSTED" "$source_file" \
  || fail "missing self-signed rejection message"

grep -q "MOVE WS-CERT-SERIAL-NUM TO CS-CERT-SERIAL" "$source_file" \
  || fail "self-signed path does not query CERT-STORE-FILE by serial"

grep -q "IF CS-IS-TRUST-ANCHOR" "$source_file" \
  || fail "self-signed path does not require trust-anchor status"

printf 'PASS: empty-chain certificate validation regression checks\n'
