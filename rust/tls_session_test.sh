#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_FILE="$ROOT_DIR/tls_session.rs"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cp "$SRC_FILE" "$TMP_DIR/lib.rs"

rustc --test "$TMP_DIR/lib.rs" -o "$TMP_DIR/tls_session_tests"
"$TMP_DIR/tls_session_tests"

echo "tls_session regression tests passed"
