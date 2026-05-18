#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_FILE="$ROOT_DIR/tls_cert_validator.c"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

grep -q 'CRYPTO_memcmp' "$SRC_FILE"
! grep -q 'memcmp(fp1, fp2, FINGERPRINT_LEN)' "$SRC_FILE"

cc -fsyntax-only $(pkg-config --cflags openssl) "$SRC_FILE"

echo "tls_cert_validator constant-time compare regression test passed"
