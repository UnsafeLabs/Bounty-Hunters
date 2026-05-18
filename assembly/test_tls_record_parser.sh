#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASM_FILE="$ROOT_DIR/assembly/tls_record_parser.asm"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

OBJ_FILE="$TMP_DIR/tls_record_parser.o"

nasm -f elf64 "$ASM_FILE" -o "$OBJ_FILE"

grep -qF 'jg .invalid_type' "$ASM_FILE"

echo "tls_record_parser content-type bounds regression test passed"
