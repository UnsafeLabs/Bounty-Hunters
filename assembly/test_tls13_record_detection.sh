#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
nasm -f elf64 tls_record_parser.asm -o tls_record_parser.o
ld tls_record_parser.o -o tls_record_parser
tls13=$(printf '\x17\x03\x03\x00\x01\x16' | ./tls_record_parser)
printf '%s\n' "$tls13" | grep -q 'TLS 1.3 record detected'
printf '%s\n' "$tls13" | grep -q 'Inner content type: 0x16'
tls10=$(printf '\x17\x03\x01\x00\x01\x16' | ./tls_record_parser)
printf '%s\n' "$tls10" | grep -q 'ApplicationData'
if printf '%s\n' "$tls10" | grep -q 'TLS 1.3 record detected'; then
  echo "TLS 1.0 application record should not be treated as TLS 1.3" >&2
  exit 1
fi