import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./TLS-CERT-VALIDATOR.cbl', import.meta.url), 'utf8');

function includes(fragment, message) {
  assert.ok(source.includes(fragment), message);
}

function matches(pattern, message) {
  assert.ok(pattern.test(source), message);
}

matches(/SET WS-CHAIN-IS-INVALID TO TRUE[\s\S]*MOVE FUNCTION CURRENT-DATE/, 'chain should start invalid by default');
matches(/IF WS-CHAIN-LENGTH = 0[\s\S]*PERFORM 2100-VALIDATE-SELF-SIGNED-CERT[\s\S]*GO TO 2000-EXIT/, 'zero-length chains should branch before table access');
matches(/IF WS-CHAIN-LENGTH > 0[\s\S]*PERFORM VARYING WS-CHAIN-INDEX/, 'chain table loop should be guarded by length > 0');
matches(/UNTIL WS-CHAIN-INDEX > WS-CHAIN-LENGTH(?! \+ 1)/, 'loop should not read one entry past chain length');
includes("DISPLAY 'TLSVAL-W010: EMPTY CERT CHAIN'", 'empty chain should log an audit-visible warning');
includes('2100-VALIDATE-SELF-SIGNED-CERT.', 'self-signed validation paragraph should exist');
matches(/MOVE WS-CERT-SERIAL-NUM TO CS-CERT-SERIAL[\s\S]*READ CERT-STORE-FILE/, 'self-signed certificates should be checked in the trust store');
matches(/INVALID KEY[\s\S]*SELF-SIGNED CERT NOT TRUSTED[\s\S]*MOVE 'EMPTY CHAIN NOT TRUSTED'/, 'untrusted self-signed certificates should be rejected');
matches(/IF CS-IS-TRUST-ANCHOR[\s\S]*SET WS-CHAIN-IS-VALID TO TRUE/, 'trusted self-signed certificates should only pass as trust anchors');
matches(/ELSE[\s\S]*SELF-SIGNED CERT NOT TRUST ANCHOR[\s\S]*WS-VALIDATION-MSG/, 'non-anchor self-signed certs should remain invalid');

const metadata = JSON.parse(readFileSync(new URL('./.generation_meta.json', import.meta.url), 'utf8'));
assert.equal(metadata.agent, 'Codex GPT-5');
assert.ok(!metadata.initial_directives.includes('You are'), 'metadata must not leak private prompts');

console.log('cobol empty-chain checks passed');
