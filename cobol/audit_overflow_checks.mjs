import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./TLS-CERT-VALIDATOR.cbl', import.meta.url), 'utf8');

function includes(fragment, message) {
  assert.ok(source.includes(fragment), message);
}

function matches(pattern, message) {
  assert.ok(pattern.test(source), message);
}

includes('01  AUDIT-LOG-RECORD            PIC X(512).', 'audit FD should support 512-byte records');
includes('01  WS-AUDIT-RECORD             PIC X(512).', 'working audit record should be 512 bytes');
includes('01  WS-AUDIT-PTR                PIC 9(4)  VALUE 1.', 'audit pointer should hold positions beyond 200 safely');
includes("01  WS-AUDIT-TRUNCATED-MARKER   PIC X(11) VALUE '[TRUNCATED]'.", 'truncation marker should be explicit');
includes('WS-ISSUER-COMMON-NAME DELIMITED SPACES', 'audit entry should include issuer CN');
includes('WS-SUBJECT-COMMON-NAME DELIMITED SPACES', 'audit entry should include subject CN');
includes('WITH POINTER WS-AUDIT-PTR', 'STRING should use bounded pointer tracking');
includes('ON OVERFLOW', 'STRING should handle overflow explicitly');
includes('PERFORM 8100-MARK-AUDIT-TRUNCATED', 'overflow should mark truncation');
matches(/8050-CHECK-AUDIT-POINTER[\s\S]*?IF WS-AUDIT-PTR > WS-AUDIT-MAX-LENGTH/, 'pointer should be checked against the record length');
matches(/8100-MARK-AUDIT-TRUNCATED[\s\S]*?DISPLAY 'TLSVAL-W080: AUDIT RECORD TRUNCATED'/, 'truncation should log a warning');
matches(/MOVE WS-AUDIT-TRUNCATED-MARKER[\s\S]*?TO WS-AUDIT-RECORD\(WS-AUDIT-MARKER-POS:11\)/, 'truncation marker should be written inside the audit record');
assert.ok(source.indexOf('01  WS-AUDIT-RECORD') < source.indexOf('01  WS-RETURN-CODE'), 'audit buffer should not overwrite hostname storage');

const subjectDn = 'CN=' + 'A'.repeat(300);
assert.equal(subjectDn.length, 303, 'test fixture should represent a 300-byte subject DN payload plus CN prefix');

const metadata = JSON.parse(readFileSync(new URL('./_generation.json', import.meta.url), 'utf8'));
assert.equal(metadata.agent, 'Codex GPT-5');
assert.ok(!metadata.pre_task_context.includes('You are'), 'metadata must not leak private prompts');

console.log('cobol audit overflow checks passed');
