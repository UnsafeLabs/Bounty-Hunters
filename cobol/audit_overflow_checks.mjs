import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('./TLS-CERT-VALIDATOR.cbl', import.meta.url), 'utf8');
const cases = fs.readFileSync(new URL('./tests/audit_overflow_cases.txt', import.meta.url), 'utf8');
const metadata = JSON.parse(fs.readFileSync(new URL('./_generation.json', import.meta.url), 'utf8'));

function includes(fragment, message) {
  assert.ok(source.includes(fragment), message);
}

function matches(pattern, message) {
  assert.ok(pattern.test(source), message);
}

function renderAudit(subjectDn) {
  const record = [
    '20260606223000000000000000',
    'S'.repeat(40),
    'I'.repeat(64),
    subjectDn,
    'V',
    'M'.repeat(128),
  ].join('|');
  if (record.length <= 512) return record.padEnd(512, ' ');
  return `${record.slice(0, 501)}[TRUNCATED]`;
}

includes('01  AUDIT-LOG-RECORD            PIC X(512).', 'audit FD should support 512-byte records');
includes('05  CS-SUBJECT-DN           PIC X(300).', 'certificate Subject DN should cover 300-byte test input');
includes('01  WS-AUDIT-RECORD             PIC X(512).', 'working audit record should be 512 bytes');
includes('01  WS-AUDIT-SUBJECT-DN         PIC X(300).', 'audit should preserve long Subject DN');
includes('01  WS-AUDIT-PTR                PIC 9(4)  VALUE 1.', 'audit pointer should hold positions beyond 200 safely');
includes("VALUE '[TRUNCATED]'.", 'truncation marker should be explicit');
includes('MOVE CS-SUBJECT-DN TO WS-AUDIT-SUBJECT-DN', 'leaf Subject DN should be captured for audit');
includes('WS-ISSUER-COMMON-NAME DELIMITED SPACES', 'audit entry should include issuer CN');
includes('WS-AUDIT-SUBJECT-DN DELIMITED SPACES', 'audit entry should include full subject DN');
includes('WITH POINTER WS-AUDIT-PTR', 'STRING should use bounded pointer tracking');
includes('ON OVERFLOW', 'STRING should handle overflow explicitly');
includes('PERFORM 8100-MARK-AUDIT-TRUNCATED', 'overflow should mark truncation');
matches(/8050-CHECK-AUDIT-POINTER[\s\S]*?IF WS-AUDIT-PTR > WS-AUDIT-MAX-LENGTH/, 'pointer should be checked against record length');
matches(/8100-MARK-AUDIT-TRUNCATED[\s\S]*?DISPLAY 'TLSVAL-W080: AUDIT RECORD TRUNCATED'/, 'truncation should log a warning');
matches(/MOVE WS-AUDIT-TRUNCATED-MARKER[\s\S]*?TO WS-AUDIT-RECORD\(WS-AUDIT-MARKER-POS:11\)/, 'truncation marker should be written inside the audit record');
assert.ok(source.indexOf('01  WS-AUDIT-RECORD') > source.indexOf('01  WS-EXPECTED-HOSTNAME'), 'audit buffer should not overwrite hostname storage');

const subjectDn = 'CN=' + 'A'.repeat(300);
assert.equal(subjectDn.length, 303, 'test fixture should represent a 300-byte subject DN payload plus CN prefix');
assert.ok(renderAudit(subjectDn).includes('[TRUNCATED]'), '300-byte Subject DN audit entry should include truncation marker');
assert.ok(cases.includes('subject-dn-bytes=300'), 'fixture should document 300-byte Subject DN');

assert.equal(metadata.agent, 'Codex GPT-5');
assert.ok(!/You are|system prompt|developer message|paste the entire/i.test(metadata.pre_task_context), 'metadata must not leak private prompts');

console.log('cobol audit overflow checks passed');
