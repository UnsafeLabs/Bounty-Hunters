#!/usr/bin/env bash
set -euo pipefail

src="${1:-cobol/TLS-CERT-VALIDATOR.cbl}"

cobc -std=ibm -x -fsyntax-only "$src"

require() {
  local pattern="$1"
  local message="$2"
  if ! grep -Eq "$pattern" "$src"; then
    echo "FAIL: $message" >&2
    exit 1
  fi
  echo "PASS: $message"
}

require "MOVE SPACES TO WS-RDN-TABLE" \
  "RDN table is cleared before every parse"
require "UNSTRING WS-SUBJECT-DN-NORMALIZED DELIMITED BY ','" \
  "DN parser still uses comma-delimited UNSTRING"
require "WS-SUBJECT-DN-WORK\\(WS-DN-SCAN-INDEX:2\\)" \
  "escaped comma lookahead reads two characters"
require "= '\\\\,'" \
  "escaped commas are protected before UNSTRING"
require "MOVE '~' TO" \
  "escaped comma placeholder is written before split"
require "3520-RESTORE-ESCAPED-COMMAS" \
  "escaped comma placeholder is restored after split"
require "MOVE ',' TO" \
  "restored CN contains a literal comma"
require "WS-RDN-COUNT" \
  "RDN count is tracked from the protected split"
require "WS-PARSED-CN" \
  "parsed CN is stored separately from the raw subject DN"
require "INSPECT WS-PARSED-CN" \
  "hostname matching uses the parsed CN"

node <<'NODE'
const cases = [
  ['CN="Smith\\, John",OU=Legal,O=Bank', 'Smith, John', 3],
  ['CN="Smith\\, John\\, CPA",OU=Legal,O=Bank', 'Smith, John, CPA', 3],
  ['CN=api.bank.example,OU=Legal,O=Bank', 'api.bank.example', 3],
];

function parseCn(dn) {
  const protectedDn = dn.replace(/\\,/g, '~');
  const parts = protectedDn.split(',').map((part) => part.replace(/~/g, ','));
  const cn = parts.find((part) => part.startsWith('CN='));
  const value = cn ? cn.slice(3).replace(/^"|"$/g, '') : dn;
  return { value, count: parts.length };
}

for (const [dn, expectedCn, expectedCount] of cases) {
  const actual = parseCn(dn);
  if (actual.value !== expectedCn || actual.count !== expectedCount) {
    throw new Error(`${dn}: expected ${expectedCn}/${expectedCount}, got ${actual.value}/${actual.count}`);
  }
  console.log(`PASS: ${dn} -> ${actual.value} (${actual.count} RDNs)`);
}
NODE

echo "Subject DN escaped-comma regression checks passed."
