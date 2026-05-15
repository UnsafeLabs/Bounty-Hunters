#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
nasm -f elf64 tls_record_parser.asm -o tls_record_parser.o
ld tls_record_parser.o -o tls_record_parser
invalid=$(printf '\x19\x03\x03\x00\x00' | ./tls_record_parser)
printf '%s\n' "$invalid" | grep -q 'Error: invalid content type in record header'
application=$(printf '\x17\x03\x03\x00\x00' | ./tls_record_parser)
printf '%s\n' "$application" | grep -q 'ApplicationData'
heartbeat=$(printf '\x18\x03\x03\x00\x00' | ./tls_record_parser)
printf '%s\n' "$heartbeat" | grep -q 'Heartbeat'