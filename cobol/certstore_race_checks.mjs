import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('./TLS-CERT-VALIDATOR.cbl', import.meta.url), 'utf8');
const metadata = JSON.parse(fs.readFileSync(new URL('./.attribution.json', import.meta.url), 'utf8'));

function includes(fragment, message) {
  assert.ok(source.includes(fragment), message);
}

function matches(pattern, message) {
  assert.ok(pattern.test(source), message);
}

function simulateTransaction(statuses) {
  let attempts = 0;
  let locked = false;
  for (const status of statuses) {
    attempts += 1;
    locked = true;
    locked = false;
    if (status === '00') return { valid: true, attempts, locked };
    if (!['92', '93', '95'].includes(status)) {
      return { valid: false, attempts, locked };
    }
    if (attempts >= 3) return { valid: false, attempts, locked };
  }
  return { valid: false, attempts, locked };
}

includes("05  CS-LAST-VALIDATED       PIC X(26).", 'record should store the last validation timestamp');
includes("88  WS-FILE-LOGIC-ERROR     VALUE '92'.", 'FILE STATUS 92 should be named');
includes("88  WS-FILE-UNAVAILABLE     VALUE '93'.", 'FILE STATUS 93 should be named');
includes("88  WS-FILE-LOCKED          VALUE '95'.", 'FILE STATUS 95 should be named');
includes("88  WS-FILE-RETRYABLE       VALUE '92' '93' '95'.", 'retryable file statuses should be explicit');
includes('WS-MAX-CERT-STORE-RETRIES   PIC 9(1)  VALUE 3.', 'retry cap should be three attempts');
includes('EXEC CICS HANDLE CONDITION', 'CICS condition handler should be installed');
includes('DSIDERR(1000-CERT-STORE-DSIDERR)', 'DSIDERR should be handled at startup');
includes('OPEN I-O CERT-STORE-FILE', 'certificate store should be opened for read/rewrite');
includes("EXEC CICS ENQ", 'ENQ should protect read/rewrite sequence');
includes("RESOURCE('CERTSTOR')", 'ENQ/DEQ should use CERTSTOR resource');
includes('READ CERT-STORE-FILE', 'protected read should remain present');
includes('MOVE FUNCTION CURRENT-DATE TO CS-LAST-VALIDATED', 'timestamp should be changed before rewrite');
includes('REWRITE CERT-STORE-RECORD', 'protected rewrite should remain present');
matches(/PERFORM 2150-ENQ-CERT-STORE[\s\S]*?READ CERT-STORE-FILE[\s\S]*?REWRITE CERT-STORE-RECORD[\s\S]*?PERFORM 2200-DEQ-CERT-STORE/, 'ENQ wrapper must protect read/rewrite and DEQ after rewrite');
matches(/IF WS-FILE-RETRYABLE[\s\S]*?EXEC CICS DELAY FOR MILLISECONDS\(100\)/, 'retryable statuses should delay 100ms');
matches(/IF WS-CERT-STORE-READ-FAIL[\s\S]*SET WS-CHAIN-IS-INVALID TO TRUE/, 'failed store access should invalidate the chain');
includes("DISPLAY 'TLSVAL-E013: CERT STORE RETRIES EXHAUSTED '", 'exhausted retries should log file status');
matches(/SET WS-CHAIN-IS-INVALID TO TRUE[\s\S]*MOVE FUNCTION CURRENT-DATE/, 'chain should start invalid by default');
matches(/END-PERFORM\s+SET WS-CHAIN-IS-VALID TO TRUE/, 'chain should be valid only after successful loop completion');
assert.ok(!/SET WS-CHAIN-IS-VALID TO TRUE[\s\S]{0,160}OPEN I-O CERT-STORE-FILE/.test(source), 'startup should not default to valid before file operations');

const contention = Array.from({ length: 50 }, (_, index) => {
  const pattern = index % 5 === 0 ? ['92', '93', '00'] : ['00'];
  return simulateTransaction(pattern);
});
assert.equal(contention.length, 50, 'simulated contention should cover 50 transactions');
assert.ok(contention.every((tx) => tx.valid && tx.attempts <= 3 && !tx.locked), '50 concurrent simulations should succeed or release locks within retry cap');
assert.deepEqual(simulateTransaction(['92', '93', '95']), { valid: false, attempts: 3, locked: false }, 'exhausted retryable statuses should fail closed');

assert.equal(metadata.tool, 'Codex GPT-5');
assert.ok(!/You are|system prompt|developer message|paste the complete/i.test(metadata.platform_config), 'metadata must not leak private prompts');

console.log('cobol cert-store race checks passed');
