import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./TLS-CERT-VALIDATOR.cbl', import.meta.url), 'utf8');

function includes(fragment, message) {
  assert.ok(source.includes(fragment), message);
}

function matches(pattern, message) {
  assert.ok(pattern.test(source), message);
}

includes("88  WS-FILE-LOGIC-ERROR     VALUE '92'.", 'FILE STATUS 92 should be named');
includes("88  WS-FILE-UNAVAILABLE     VALUE '93'.", 'FILE STATUS 93 should be named');
includes("88  WS-FILE-LOCKED          VALUE '95'.", 'FILE STATUS 95 should be named');
includes("88  WS-FILE-RETRYABLE       VALUE '92' '93' '95'.", 'retryable file statuses should be explicit');
includes('WS-MAX-CERT-STORE-RETRIES   PIC 9(1)  VALUE 3.', 'retry cap should be three attempts');
includes('EXEC CICS HANDLE CONDITION', 'CICS condition handler should be installed');
includes('DSIDERR(1000-CERT-STORE-DSIDERR)', 'DSIDERR should be handled at startup');
includes("OPEN I-O CERT-STORE-FILE", 'certificate store should be opened for read/rewrite');
includes("EXEC CICS ENQ", 'ENQ should protect read/rewrite sequence');
includes("RESOURCE('CERTSTOR')", 'ENQ/DEQ should use CERTSTOR resource');
includes('READ CERT-STORE-FILE', 'protected read should remain present');
includes('REWRITE CERT-STORE-RECORD', 'protected rewrite should remain present');
matches(/REWRITE CERT-STORE-RECORD[\s\S]*?PERFORM 2200-DEQ-CERT-STORE/, 'DEQ should happen after rewrite');
matches(/REWRITE CERT-STORE-RECORD[\s\S]*?IF WS-FILE-OK[\s\S]*?SET WS-CERT-STORE-READ-OK TO TRUE[\s\S]*?ELSE[\s\S]*?IF WS-FILE-RETRYABLE/, 'rewrite failures should be checked and retried when retryable');
includes('EXEC CICS DELAY FOR MILLISECONDS(100)', 'retry delay should be 100 milliseconds');
matches(/IF WS-CERT-STORE-READ-FAIL[\s\S]*SET WS-CHAIN-IS-INVALID TO TRUE/, 'failed store access should invalidate the chain');
includes("DISPLAY 'TLSVAL-E013: CERT STORE RETRIES EXHAUSTED '", 'exhausted retries should be logged');
matches(/SET WS-CHAIN-IS-INVALID TO TRUE[\s\S]*MOVE FUNCTION CURRENT-DATE/, 'chain should start invalid by default');
matches(/END-PERFORM\s+SET WS-CHAIN-IS-VALID TO TRUE/, 'chain should be marked valid only after successful loop completion');
assert.ok(!/SET WS-CHAIN-IS-VALID TO TRUE[\s\S]{0,120}OPEN I-O CERT-STORE-FILE/.test(source), 'startup should not default to valid before file operations');

const metadata = JSON.parse(readFileSync(new URL('./.attribution.json', import.meta.url), 'utf8'));
assert.equal(metadata.tool, 'Codex GPT-5');
assert.ok(!metadata.platform_config.includes('You are'), 'metadata must not leak private prompts');

console.log('cobol cert-store race checks passed');
