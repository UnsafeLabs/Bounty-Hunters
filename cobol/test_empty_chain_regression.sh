#!/usr/bin/env bash
set -euo pipefail

source_file="${1:-cobol/TLS-CERT-VALIDATOR.cbl}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

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

grep -q "EMPTY NON-SELF-SIGNED CHAIN" "$source_file" \
  || fail "empty non-self-signed chains are not rejected before trust-store lookup"

grep -q "MOVE WS-CERT-SERIAL-NUM TO CS-CERT-SERIAL" "$source_file" \
  || fail "self-signed path does not query CERT-STORE-FILE by serial"

grep -q "IF CS-IS-TRUST-ANCHOR" "$source_file" \
  || fail "self-signed path does not require trust-anchor status"

if command -v cobc >/dev/null 2>&1; then
  validator="$tmp_dir/tls-cert-validator"
  setup_source="$tmp_dir/make_empty_certstore.cbl"
  cp "$source_file" "$tmp_dir/TLS-CERT-VALIDATOR.cbl"

  cobc -std=ibm -x "$tmp_dir/TLS-CERT-VALIDATOR.cbl" \
    -o "$validator"

  cat > "$setup_source" <<'COBOL'
       IDENTIFICATION DIVISION.
       PROGRAM-ID. MAKE-EMPTY-CERTSTORE.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT CERT-STORE-FILE ASSIGN TO 'CERTSTOR'
               ORGANIZATION IS INDEXED ACCESS MODE IS DYNAMIC
               RECORD KEY IS CS-CERT-SERIAL
               FILE STATUS IS WS-FILE-STATUS.
       DATA DIVISION.
       FILE SECTION.
       FD  CERT-STORE-FILE.
       01  CERT-STORE-RECORD.
           05  CS-CERT-SERIAL          PIC X(40).
           05  CS-ISSUER-DN            PIC X(256).
           05  CS-SUBJECT-DN           PIC X(256).
           05  CS-NOT-BEFORE           PIC X(14).
           05  CS-NOT-AFTER            PIC X(14).
           05  CS-KEY-LENGTH           PIC 9(5).
           05  CS-SIG-ALGORITHM        PIC X(20).
           05  CS-FINGERPRINT          PIC X(64).
           05  CS-TRUST-ANCHOR-FLAG    PIC X(1).
       WORKING-STORAGE SECTION.
       01  WS-FILE-STATUS              PIC XX.
       PROCEDURE DIVISION.
           OPEN OUTPUT CERT-STORE-FILE
           IF WS-FILE-STATUS NOT = '00'
               DISPLAY 'CERTSTOR-SETUP-FAILED ' WS-FILE-STATUS
               STOP RUN
           END-IF
           CLOSE CERT-STORE-FILE
           STOP RUN.
COBOL

  cobc -std=ibm -x "$setup_source" -o "$tmp_dir/make-empty-certstore"
  (
    cd "$tmp_dir"
    ./make-empty-certstore
    : > CRLDATA
    set +e
    ./tls-cert-validator > validator.out 2>&1
    status=$?
    set -e
    if [ "$status" -ne 0 ]; then
      cat validator.out >&2
      fail "validator abended for empty certificate chain"
    fi
    grep -q "TLSVAL-W012: EMPTY CERT CHAIN" validator.out \
      || fail "runtime did not audit empty certificate chain"
    grep -q "TLSVAL-E012: SELF-SIGNED CERT NOT TRUSTED" validator.out \
      || fail "runtime did not reject empty self-signed chain absent from CERT-STORE-FILE"
    grep -q "TLSVAL-I099: RC=.*8" validator.out \
      || fail "runtime did not finish with invalid certificate return code"
  )
else
  printf 'SKIP: cobc not installed; static regression checks passed\n'
fi

printf 'PASS: empty-chain certificate validation regression checks\n'
