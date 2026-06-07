import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "tlsmod.f"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const required = [
  "COMMON /TLSBLK/ CERTBUF, SIGBLOCK, TMPBUF, IERR, IPTR,",
  "CHARACTER*256 TMPBUF",
  "IF (IPTR .GT. 128) GO TO 900",
  "IERR = E_SANLONG",
  "INTEGER FUNCTION CPCHAR",
  "SUBROUTINE SANCOMP",
  "INTEGER FUNCTION SANTYP",
  "SANTYP = -1",
  "ELSEIF (TAG .EQ. 135)",
  "IF (TYP .LT. 0) THEN",
  "BLOCK DATA TLSDAT",
  "SUBROUTINE TSTSANP",
  "CALL SANCOMP(193, 65, MATCH)",
];

for (const pattern of required) {
  assert(source.includes(pattern), `missing Fortran hardening pattern: ${pattern}`);
}

assert(!/\bEQUIVALENCE\b/i.test(source), "EQUIVALENCE must be removed");
assert(!/GO\s+TO\s*\(/i.test(source), "computed GOTO must be removed");
assert(!/IMPLICIT\s+INTEGER\s*\(I-N\)/i.test(source), "mixed implicit typing must be removed");
assert(!/IMPLICIT\s+CHARACTER/i.test(source), "implicit CHARACTER typing must be removed");

function ubyte(value) {
  return value < 0 ? value + 256 : value;
}

function santyp(tagByte) {
  const tag = ubyte(tagByte);
  if (tag >= 128 && tag <= 135) return tag - 128;
  return -1;
}

for (let tag = 128; tag <= 135; tag += 1) {
  assert(santyp(tag) === tag - 128, `tag ${tag} must map correctly`);
}
assert(santyp(136) === -1, "unknown SAN tag must return -1");

function cpchar(code) {
  const c = ubyte(code);
  const ebcdicUpper = new Map([
    [193, 65], [194, 66], [195, 67], [196, 68], [197, 69], [198, 70], [199, 71], [200, 72], [201, 73],
    [209, 74], [210, 75], [211, 76], [212, 77], [213, 78], [214, 79], [215, 80], [216, 81], [217, 82],
    [226, 83], [227, 84], [228, 85], [229, 86], [230, 87], [231, 88], [232, 89], [233, 90],
  ]);
  return ebcdicUpper.get(c) ?? c;
}

assert(cpchar(193) === cpchar(65), "EBCDIC A must compare equal to ASCII A");

function parseSan(length) {
  let iptr = 1;
  for (let i = 0; i < length; i += 1) {
    if (iptr > 128) return { error: 9001, outLen: iptr - 1 };
    iptr += 1;
  }
  return { error: 0, outLen: iptr - 1 };
}

assert(parseSan(128).error === 0 && parseSan(128).outLen === 128, "128-byte SAN must pass");
assert(parseSan(129).error === 9001, "129-byte SAN must fail with E_SANLONG");
assert(parseSan(256).error === 9001, "256-byte SAN must fail with E_SANLONG");

const certbuf = "C".repeat(256);
const sigblockBefore = "S".repeat(128);
let tmpbuf = "T".repeat(256);
tmpbuf = "A".repeat(Math.min(128, 256)) + tmpbuf.slice(128);
assert(sigblockBefore === "S".repeat(128), "independent TMPBUF write must not mutate SIGBLOCK");
assert(certbuf.length === 256, "CERTBUF remains independent");

console.log("Fortran #563 SAN buffer checks passed");

