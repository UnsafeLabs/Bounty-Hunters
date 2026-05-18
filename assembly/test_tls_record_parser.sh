#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASM_FILE="$ROOT_DIR/assembly/tls_record_parser.asm"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

OBJ_FILE="$TMP_DIR/tls_record_parser.o"

nasm -f elf64 "$ASM_FILE" -o "$OBJ_FILE"

grep -qF 'lea eax, [r15d + 5]' "$ASM_FILE"
grep -qF 'cmp eax, r12d' "$ASM_FILE"
grep -qF 'ja .invalid_length' "$ASM_FILE"

echo "tls_record_parser payload-length regression test passed"
