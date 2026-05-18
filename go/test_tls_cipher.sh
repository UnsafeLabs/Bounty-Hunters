#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat >"$TMP_DIR/go.mod" <<'EOF'
module tlscipher_test

go 1.22
EOF

cp "$ROOT_DIR/tls_cipher.go" "$TMP_DIR/"
cp "$ROOT_DIR/tls_cipher_test.go" "$TMP_DIR/"

(cd "$TMP_DIR" && go test ./...)

echo "tls_cipher preference regression tests passed"
