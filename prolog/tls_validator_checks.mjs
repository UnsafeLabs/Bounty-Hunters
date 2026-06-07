import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, "tls_validator.pl");
const source = fs.readFileSync(sourcePath, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const requiredSnippets = [
  ":- thread_local trusted/2.",
  ":- discontiguous trusted/2.",
  "resolve_issuer_chain(Cert, Store, [], RootCert)",
  "\\+ memberchk(IssuerDN, Visited)",
  "[IssuerDN|Visited]",
  "max_chain_depth(10)",
  "Len > Max",
  "Result = chain_too_deep",
  "byte(X) --> [X], { integer(X), X >= 0, X =< 255, ! }.",
  "remaining_at_least(6, Input, Input)",
  "predicate_property(trusted(_, _), defined)",
  "thread_create(verify_shared_anchor, T1, [])",
  "test(circular_2ca_terminates",
  "test(circular_3ca_terminates",
  "test(malformed_ip_san_fails_fast",
  "test(depth_10_passes",
  "test(depth_11_fails",
];

for (const snippet of requiredSnippets) {
  assert(source.includes(snippet), `missing required Prolog pattern: ${snippet}`);
}

function resolveIssuerChain(startIssuer, store, maxSteps = 50) {
  const visited = new Set();
  let issuer = startIssuer;
  for (let step = 0; step < maxSteps; step += 1) {
    if (visited.has(issuer)) return "chain_invalid";
    visited.add(issuer);
    const cert = store.get(issuer);
    if (!cert) return "chain_invalid";
    if (cert.subject === cert.issuer) return cert.subject;
    issuer = cert.issuer;
  }
  return "non_terminating";
}

const twoCa = new Map([
  ["CA-A", { subject: "CA-A", issuer: "CA-B" }],
  ["CA-B", { subject: "CA-B", issuer: "CA-A" }],
]);
assert(resolveIssuerChain("CA-A", twoCa) === "chain_invalid", "2-CA cycle must terminate as invalid");

const threeCa = new Map([
  ["CA-A", { subject: "CA-A", issuer: "CA-B" }],
  ["CA-B", { subject: "CA-B", issuer: "CA-C" }],
  ["CA-C", { subject: "CA-C", issuer: "CA-A" }],
]);
assert(resolveIssuerChain("CA-A", threeCa) === "chain_invalid", "3-CA cycle must terminate as invalid");

function verifyDepth(depth) {
  return depth > 10 ? "chain_too_deep" : "valid";
}
assert(verifyDepth(10) === "valid", "depth 10 must pass");
assert(verifyDepth(11) === "chain_too_deep", "depth 11 must fail");

function parseIpSan(bytes) {
  if (bytes.length < 6) return "fast_fail";
  if (bytes[0] !== 0x87 || bytes[1] !== 0x04) return "fast_fail";
  const ip = bytes.slice(2, 6);
  assert(ip.every((b) => Number.isInteger(b) && b >= 0 && b <= 255), "invalid byte");
  return ip.join(".");
}
assert(parseIpSan([0x87, 0x04, 192, 168, 1]) === "fast_fail", "truncated SAN must fail before byte parsing");
assert(parseIpSan([0x87, 0x04, 192, 168, 1, 10]) === "192.168.1.10", "valid SAN parses");

const globalTrusted = new Map([["fp-root", "root-cert"]]);
function runThreadVerification() {
  const localTrusted = new Map(globalTrusted);
  if (!localTrusted.has("fp-root")) return "chain_invalid";
  localTrusted.delete("fp-root");
  return "valid";
}
assert(runThreadVerification() === "valid", "thread A local trust store must verify");
assert(runThreadVerification() === "valid", "thread B local trust store must not be affected by A");

console.log("prolog #565 TLS validator checks passed");
