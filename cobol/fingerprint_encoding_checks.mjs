import fs from 'node:fs';

const source = fs.readFileSync(new URL('./TLS-CERT-VALIDATOR.cbl', import.meta.url), 'utf8');
const cases = fs.readFileSync(new URL('./tests/fingerprint_encoding_cases.txt', import.meta.url), 'utf8');
const contributor = JSON.parse(fs.readFileSync(new URL('./contributor_meta.json', import.meta.url), 'utf8'));

function parseCases(text) {
  return text.trim().split(/\n\s*\n/).map((block) => {
    return Object.fromEntries(block.split('\n').map((line) => {
      const index = line.indexOf(':');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }));
  });
}

function ordCompare(expected, actual) {
  if (expected.length !== 64 || actual.length !== 64) {
    return 'invalid';
  }
  for (let i = 0; i < 64; i += 1) {
    if (expected.charCodeAt(i) !== actual.charCodeAt(i)) return 'invalid';
  }
  return 'valid';
}

const caseFailures = parseCases(cases).flatMap((testCase) => {
  const result = ordCompare(testCase.expected, testCase.actual);
  return result === testCase.result
    ? []
    : [`${testCase.case}: ${result} != ${testCase.result}`];
});

const checks = [
  ['signature buffer declared with same PIC X width as CS-CERT-FINGERPRINT', /05  CS-FINGERPRINT\s+PIC X\(64\)[\s\S]*01  WS-SIG-VERIFY-BUFFER\s+PIC X\(64\)/],
  ['signature buffer is cleared during initialization', /MOVE SPACES TO WS-SIG-VERIFY-BUFFER/],
  ['leaf expected fingerprint is captured from CERT-STORE-FILE', /IF WS-CHAIN-INDEX = 1\s+MOVE CS-FINGERPRINT TO WS-SIG-VERIFY-BUFFER\s+END-IF/s],
  ['actual fingerprint is not moved into the verify buffer before comparison', !/MOVE WS-CERT-FINGERPRINT TO WS-SIG-VERIFY-BUFFER/.test(source)],
  ['bytewise ORD comparison uses actual fingerprint and saved expected buffer', /FUNCTION ORD\(\s*WS-CERT-FINGERPRINT\(WS-FINGERPRINT-INDEX:1\)\)[\s\S]*FUNCTION ORD\(\s*WS-SIG-VERIFY-BUFFER\(WS-FINGERPRINT-INDEX:1\)\)/],
  ['mismatch invalidates signature', /IF WS-FINGERPRINT-MISMATCH\s+SET WS-SIG-INVALID TO TRUE/s],
  ['fingerprint display logs the original actual field', /DISPLAY 'TLSVAL-I040: FINGERPRINT '\s+WS-CERT-FINGERPRINT/],
  ['A-F regression case documented', /AABBCCDDEEFF/.test(cases)],
  ['digits-only regression case documented', /00112233445566778899001122334455/.test(cases)],
  ['mismatch regression case documented', /case: mismatch/.test(cases)],
  ['safe contributor metadata', contributor.name === 'Codex GPT-5' && !/paste the complete|system message|developer message/i.test(contributor.session_init)],
];

const failures = checks.filter(([, ok]) => {
  if (ok instanceof RegExp) return !ok.test(source);
  return !ok;
});

if (failures.length || caseFailures.length) {
  console.error('COBOL fingerprint encoding checks failed:');
  for (const [name] of failures) console.error(`- ${name}`);
  for (const failure of caseFailures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`COBOL fingerprint encoding checks passed (${checks.length} static, ${parseCases(cases).length} simulated).`);
