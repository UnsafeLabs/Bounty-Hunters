import fs from 'node:fs';

const source = fs.readFileSync(new URL('./TLS-CERT-VALIDATOR.cbl', import.meta.url), 'utf8');
const cases = fs.readFileSync(new URL('./tests/subject_dn_escaped_comma_cases.txt', import.meta.url), 'utf8');

function parseSubjectDn(dn) {
  const marker = '\u001f';
  const protectedDn = dn.replaceAll('\\,', marker);
  const rdns = protectedDn.split(',').map((rdn) => rdn.replaceAll(marker, ','));
  const cnRdn = rdns.find((rdn) => rdn.trimStart().startsWith('CN='));
  const cn = cnRdn
    ? cnRdn.trimStart().slice(3).replace(/^"/, '').replaceAll('"', '')
    : '';
  return { cn, rdnCount: rdns.length };
}

const parsedCases = cases
  .trim()
  .split(/\n\s*\n/)
  .map((block) => Object.fromEntries(block.split('\n').map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  })));

const caseFailures = parsedCases.flatMap((testCase) => {
  const parsed = parseSubjectDn(testCase['subject-dn']);
  const failures = [];
  if (parsed.cn !== testCase['parsed-cn']) {
    failures.push(`${testCase.case}: parsed CN ${parsed.cn} != ${testCase['parsed-cn']}`);
  }
  if (String(parsed.rdnCount) !== testCase['rdn-count']) {
    failures.push(`${testCase.case}: RDN count ${parsed.rdnCount} != ${testCase['rdn-count']}`);
  }
  if (testCase['hostname-match'] !== 'Y') {
    failures.push(`${testCase.case}: hostname match expectation must be Y`);
  }
  return failures;
});

const checks = [
  ['parse paragraph is called before hostname match', /PERFORM 4000-VERIFY-SIGNATURE\s+PERFORM 3500-PARSE-SUBJECT-DN\s+PERFORM 5000-MATCH-HOSTNAME/s],
  ['leaf certificate Subject DN is captured from CERT-STORE-FILE', /IF WS-CHAIN-INDEX = 1\s+MOVE CS-SUBJECT-DN TO WS-SUBJECT-DN-FULL\s+END-IF/s],
  ['parser reads the saved full leaf Subject DN', /WS-SUBJECT-DN-FULL\(WS-DN-SRC-IDX:2\)\s*=\s*'\\,'/],
  ['parser does not inspect only the existing common-name field for escaped delimiters', !/WS-SUBJECT-COMMON-NAME\(WS-DN-SRC-IDX:2\)\s*=\s*'\\,'/.test(source)],
  ['escaped comma placeholder is defined', /WS-ESCAPED-COMMA-MARK\s+PIC X\s+VALUE X'1F'/],
  ['RDN table is cleared before parsing', /MOVE SPACES TO WS-RDN-TABLE/],
  ['RDN count is reset before parsing', /MOVE 0 TO WS-RDN-COUNT/],
  ['escaped comma is preprocessed before UNSTRING', /MOVE WS-ESCAPED-COMMA-MARK\s+TO WS-SUBJECT-DN-WORK\(WS-DN-DST-IDX:1\)/],
  ['UNSTRING splits on unescaped commas and tallies actual RDNs', /UNSTRING WS-SUBJECT-DN-WORK DELIMITED BY ','[\s\S]*TALLYING IN WS-RDN-COUNT/],
  ['escaped comma placeholder is restored after splitting', /INSPECT WS-RDN-ENTRY\(WS-RDN-INDEX\)\s+CONVERTING WS-ESCAPED-COMMA-MARK TO ','/],
  ['CN is copied into the hostname matching field', /MOVE WS-PARSED-CN TO WS-SUBJECT-COMMON-NAME/],
  ['quoted CN cleanup exists', /IF WS-PARSED-CN\(1:1\) = '"'/],
  ['single escaped comma case exists', /CN="Smith\\, John",OU=Legal/],
  ['multiple escaped comma case exists', /CN="Smith\\, John\\, Jr\.",OU=Legal/],
  ['no escaped comma control case exists', /CN=api\.bank\.example,OU=Payments/],
  ['expected parsed CN includes comma', /parsed-cn=Smith, John/],
  ['RDN count excludes escaped commas', /rdn-count=3/],
  ['hostname match success is covered', /hostname-match=Y/],
];

const failures = checks.filter(([, ok]) => {
  if (ok instanceof RegExp) return !ok.test(source) && !ok.test(cases);
  return !ok;
});

if (failures.length || caseFailures.length) {
  console.error('Subject DN escaped comma checks failed:');
  for (const [name] of failures) console.error(`- ${name}`);
  for (const failure of caseFailures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Subject DN escaped comma checks passed.');
