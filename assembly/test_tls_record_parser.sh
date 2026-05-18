#!/usr/bin/env bash
set -euo pipefail

# Static regression test for the TLS record parser.
#
# The program itself uses Linux syscalls, so we validate the patched
# version-parsing path by assembling the source and inspecting the
# generated object code.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASM_FILE="$ROOT_DIR/assembly/tls_record_parser.asm"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

OBJ_FILE="$TMP_DIR/tls_record_parser.o"
DISASM_FILE="$TMP_DIR/tls_record_parser.disasm"

nasm -f elf64 "$ASM_FILE" -o "$OBJ_FILE"
objdump -d "$OBJ_FILE" > "$DISASM_FILE"

# Regression guard: the old little-endian load must be gone.
if grep -qE '\bmov\s+ax, \[rsi\+1\]' "$ASM_FILE"; then
  echo "Found old little-endian version load in source" >&2
  exit 1
fi

# The version parse must load the bytes individually and assemble them in
# big-endian order: byte 1 -> high byte, byte 2 -> low byte.
grep -qF $'movzbl\t0x1(%rsi), %eax' "$DISASM_FILE"
grep -qF $'shll\t$0x8, %eax' "$DISASM_FILE"
grep -qF $'movzbl\t0x2(%rsi), %edx' "$DISASM_FILE"
grep -qF $'orl\t%edx, %eax' "$DISASM_FILE"
grep -qF $'movl\t%eax, %r14d' "$DISASM_FILE"

echo "tls_record_parser version-endianness regression test passed"
