const fs = require("fs");
const path = require("path");

const sourcePath = path.join(__dirname, "..", "TLS-CERT-VALIDATOR.cbl");
const source = fs.readFileSync(sourcePath, "utf8");

const requiredSnippets = [
  "WS-SIG-VERIFY-BUFFER REDEFINES",
  "WS-CERT-FINGERPRINT     PIC X(64).",
  "FUNCTION ORD(WS-SIG-VERIFY-BUFFER",
  "FUNCTION ORD(CS-FINGERPRINT",
  "TLSVAL-I040: FINGERPRINT",
  "CERTIFICATE FINGERPRINT MISMATCH",
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing COBOL fingerprint fix snippet: ${snippet}`);
  }
}

if (/MOVE\s+WS-CERT-FINGERPRINT\s+TO\s+WS-SIG-VERIFY-BUFFER/i.test(source)) {
  throw new Error("Fingerprint verification must not MOVE through the display buffer");
}

function ordCompare(actual, expected) {
  if (actual.length !== expected.length) {
    return false;
  }

  for (let index = 0; index < actual.length; index += 1) {
    if (actual.charCodeAt(index) !== expected.charCodeAt(index)) {
      return false;
    }
  }

  return true;
}

const cases = [
  {
    name: "consecutive A-F characters",
    actual: "AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899",
    expected: "AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899",
    matches: true,
  },
  {
    name: "digits only",
    actual: "0011223344556677889900112233445566778899001122334455667788990011",
    expected: "0011223344556677889900112233445566778899001122334455667788990011",
    matches: true,
  },
  {
    name: "A-F mismatch",
    actual: "AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899",
    expected: "AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778898",
    matches: false,
  },
];

for (const testCase of cases) {
  const actual = ordCompare(testCase.actual, testCase.expected);

  if (actual !== testCase.matches) {
    throw new Error(`${testCase.name}: expected ${testCase.matches}, got ${actual}`);
  }
}

console.log(`fingerprint encoding checks passed: ${cases.length}`);
