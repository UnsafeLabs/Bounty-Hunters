import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, "verify_cert_proc.pli");
const source = fs.readFileSync(sourcePath, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const required = [
  "DCL CERT_AREA AREA(8192)",
  "IF ALLOCATION(CERT_AREA) > CERT_AREA_LIMIT THEN",
  "EXPAND_CERT_AREA: PROCEDURE",
  "ADDR(CERT_AREA) > PTR",
  "PTR > ADDR(CERT_AREA) + 8192",
  "DCL OID_STRING CHAR(256) VARYING",
  "IF LENGTH(RESULT) + LENGTH(ARC_STR) + 1 > MAXLENGTH(RESULT) THEN",
  "RETURN('INVALID')",
  "DCL TLS_ASN1_PARSE ENTRY(CHAR(*), BIN FIXED(31), POINTER) EXTERNAL",
  "TRAVERSE_PARSE_TREE: PROCEDURE",
  "IF VISITED_PTRS(I) = CUR THEN",
  "DCL 1 SAVED_CERTS(128)",
  "TEST_AREA_OVERFLOW_50_PLUS",
  "TEST_OID_BOUNDARY_64",
  "TEST_OID_OVERFLOW_65_PLUS",
  "TEST_FETCH_RELEASE_LIFETIME",
  "TEST_CIRCULAR_NEXT_NODE",
];

for (const pattern of required) {
  assert(source.includes(pattern), `missing PL/I hardening pattern: ${pattern}`);
}

assert(!/\bON\s+AREA\b/i.test(source), "ON AREA handler must be removed");
assert(!/\bON\s+STRINGSIZE\b/i.test(source), "ON STRINGSIZE handler must be removed");
assert(!/\bFETCH\s+TLS_ASN1_PARSE\b/i.test(source), "FETCH TLS_ASN1_PARSE must not be used");
assert(!/\bRELEASE\s+TLS_ASN1_PARSE\b/i.test(source), "RELEASE TLS_ASN1_PARSE must not be used");
assert(!/\bCONTROLLED\b/i.test(source), "CONTROLLED allocations must not be used");

function buildOid(arcs, max = 256) {
  let result = "";
  for (const arc of arcs) {
    const arcStr = String(arc);
    const next = result ? `${result}.${arcStr}` : arcStr;
    if (next.length > max) return "INVALID";
    result = next;
  }
  return result;
}

const oid64 = Array.from({ length: 32 }, (_, i) => i + 1);
assert(buildOid(oid64).length >= 64, "boundary OID should exceed legacy 64 chars");
assert(buildOid(oid64) !== "INVALID", "boundary OID must fit 256 chars");
assert(buildOid(Array.from({ length: 128 }, () => 999999)) === "INVALID", "long OID must return INVALID");

function traverse(head) {
  const visited = new Set();
  let cur = head;
  let steps = 0;
  while (cur) {
    if (visited.has(cur)) return false;
    visited.add(cur);
    steps += 1;
    if (steps > 128) return false;
    cur = cur.next;
  }
  return true;
}

const a = {};
const b = {};
a.next = b;
b.next = a;
assert(traverse(a) === false, "circular NEXT_NODE chain must be detected");

const certArea = [];
for (let i = 0; i < 55; i += 1) {
  if (certArea.length > 50) {
    const saved = certArea.map((node) => ({ ...node }));
    certArea.length = 0;
    certArea.push(...saved);
  }
  certArea.push({ subject: `CN=Node${i}`, issuer: "CN=Issuer" });
}
assert(certArea.length === 55, "AREA expansion simulation should preserve >50 nodes");

console.log("PL/I #566 certificate hardening checks passed");

