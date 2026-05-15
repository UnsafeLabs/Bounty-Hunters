#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
nasm -f elf64 tls_record_parser.asm -o tls_record_parser.o
ld tls_record_parser.o -o tls_record_parser
output=$(printf '\x15\x03\x03\x00\x02\x01\x00' | ./tls_record_parser)
printf '%s\n' "$output" | grep -q '^WARNING: alert received from peer$'
if printf '%s\n' "$output" | grep -q 'record payload truncated'; then
  echo "warning output leaked into truncated error" >&2
  exit 1
fi