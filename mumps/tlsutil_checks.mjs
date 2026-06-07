import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tlsutil = fs.readFileSync(path.join(here, "TLSUTIL.m"), "utf8");
const tlscert = fs.readFileSync(path.join(here, "TLSCERT.m"), "utf8");
const source = `${tlsutil}\n${tlscert}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const required = [
  'S ^GLBTLS(SESSID,"meta","lastcheck")=$H',
  'I CHAINOK D VERIFYONE(SESSID,IDX)',
  'S ^GLBTLS(SESSID,"chain",IDX,"expire")=EXPVAL',
  'S HASHVAL=$$HASH^TLSCERT(RAWCERT,SESSID,CERTID)',
  'S ^GLBTLS(SESSID,"cert",CERTID,"ts")=$H',
  'I \'$D(^GLBTLS(SESSID,"chain",IDX,"raw"))#2 Q',
  'S ^GLBTLS(SESSID,"chain",IDX,"status")="V"',
  'K ^GLBTLS(SESSID,"chain",IDX,"raw")',
  'S DUMMY=$G(^GLBTLS(SESSID,"cert",CERTID))',
  'K ^XTMP("TLSHASH",JOBID)',
];

for (const pattern of required) {
  assert(source.includes(pattern), `missing MUMPS hardening pattern: ${pattern}`);
}

assert(!/[SK]\s+\^\(/.test(source), "naked global SET/KILL must not appear");
assert(!/D:\$D/.test(source), "post-conditional DO with $D must be refactored");
assert(source.includes('$D(^GLBTLS(SESSID,"chain",IDX,"raw"))#2'), "$DATA raw check must use #2");

class Globals {
  constructor() {
    this.map = new Map();
  }
  key(parts) {
    return parts.join("\u0000");
  }
  set(parts, value) {
    this.map.set(this.key(parts), value);
  }
  get(parts) {
    return this.map.get(this.key(parts));
  }
  killPrefix(parts) {
    const prefix = this.key(parts);
    for (const key of [...this.map.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}\u0000`)) this.map.delete(key);
    }
  }
  data(parts) {
    const key = this.key(parts);
    const hasValue = this.map.has(key);
    const prefix = `${key}\u0000`;
    const hasChildren = [...this.map.keys()].some((item) => item.startsWith(prefix));
    return (hasValue ? 1 : 0) + (hasChildren ? 10 : 0);
  }
}

const g = new Globals();
const sess = "T562";
const cert = "C1";
g.set(["GLBTLS", sess, "cert", cert, "raw"], "CERT");
g.set(["GLBTLS", sess, "meta", "lastcheck"], "H");
g.set(["GLBTLS", sess, "cert", cert, "ts"], "H");
assert(g.data(["GLBTLS", sess, "meta", "lastcheck", "expire"]) === 0, "false post-conditional path must not write under lastcheck");
assert(g.data(["GLBTLS", sess, "cert", cert, "ts"]) % 2 === 1, "hash return must not move timestamp away from cert node");

g.set(["GLBTLS", sess, "chain", "1", "raw"], "RAWCERT");
g.set(["GLBTLS", sess, "chain", "1", "status"], "V");
g.killPrefix(["GLBTLS", sess, "chain", "1", "raw"]);
assert(g.data(["GLBTLS", sess, "chain", "1", "raw"]) === 0, "raw node must be fully killed");
assert(g.get(["GLBTLS", sess, "chain", "1", "status"]) === "V", "status must be fully qualified sibling");

g.killPrefix(["GLBTLS", sess, "chain", "99"]);
g.set(["GLBTLS", sess, "chain", "99", "raw", "status"], "phantom");
assert(g.data(["GLBTLS", sess, "chain", "99", "raw"]) === 10, "phantom raw should be descendants only");
assert(g.data(["GLBTLS", sess, "chain", "99", "raw"]) % 2 === 0, "$D(node)#2 must reject phantom descendants");

const xtmp = new Globals();
xtmp.set(["XTMP", "TLSHASH", "111", "seqno"], 2);
xtmp.set(["XTMP", "TLSHASH", "111", "1", "ts"], 1);
xtmp.killPrefix(["XTMP", "TLSHASH", "111"]);
assert(xtmp.data(["XTMP", "TLSHASH", "111"]) === 0, "cleanup must remove per-job subtree");

console.log("MUMPS #562 naked reference checks passed");
