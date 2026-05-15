#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
nasm -f elf64 tls_record_parser.asm -o tls_record_parser.o
ld tls_record_parser.o -o tls_record_parser
output=$(printf '\x16\x03\x03\x01\xf4' | ./tls_record_parser)
printf '%s\n' "$output" | grep -q 'Error: record payload truncated'