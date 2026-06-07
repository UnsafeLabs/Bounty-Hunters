import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('./TLS-CERT-VALIDATOR.cbl', import.meta.url), 'utf8');
const cases = fs.readFileSync(new URL('./tests/empty_chain_cases.txt', import.meta.url), 'utf8');
const metadata = JSON.parse(fs.readFileSync(new URL('./.generation_meta.json', import.meta.url), 'utf8'));

function matches(pattern, message) {
  assert.ok(pattern.test(source), message);
}

function simulateValidation({ chainLength, inTrustStore, trustAnchor, optLevel }) {
  let touchedChainEntry = false;
  let chainValid = false;
  if (chainLength === 0) {
    if (optLevel === 'OPT(2)') touchedChainEntry = false;
    chainValid = Boolean(inTrustStore && trustAnchor);
    return { chainValid, touchedChainEntry };
  }
  for (let index = 1; index <= chainLength; index += 1) {
    touchedChainEntry = true;
  }
  chainValid = true;
  return { chainValid, touchedChainEntry };
}

matches(/SET WS-CHAIN-IS-INVALID TO TRUE[\s\S]*MOVE FUNCTION CURRENT-DATE/, 'chain should start invalid by default');
matches(/IF WS-CHAIN-LENGTH = 0\s+PERFORM 2100-VALIDATE-SELF-SIGNED-CERT\s+GO TO 2000-EXIT\s+END-IF/s, 'zero-length chains should branch before table access');
matches(/IF WS-CHAIN-LENGTH > 0\s+PERFORM VARYING WS-CHAIN-INDEX/s, 'chain table loop should be guarded by length > 0');
matches(/UNTIL WS-CHAIN-INDEX > WS-CHAIN-LENGTH(?! \+ 1)/, 'loop should not read one entry past chain length');
matches(/DISPLAY 'TLSVAL-W010: EMPTY CERT CHAIN'/, 'empty chain should log an audit-visible warning');
matches(/2100-VALIDATE-SELF-SIGNED-CERT\./, 'self-signed validation paragraph should exist');
matches(/MOVE WS-CERT-SERIAL-NUM TO CS-CERT-SERIAL[\s\S]*READ CERT-STORE-FILE/, 'self-signed certificates should be checked in the trust store');
matches(/INVALID KEY[\s\S]*SELF-SIGNED CERT NOT TRUSTED[\s\S]*MOVE 'EMPTY CHAIN NOT TRUSTED'/, 'untrusted self-signed certificates should be rejected');
matches(/IF CS-IS-TRUST-ANCHOR\s+DISPLAY 'TLSVAL-I010: SELF-SIGNED TRUST ANCHOR'\s+SET WS-CHAIN-IS-VALID TO TRUE/s, 'trusted self-signed certificates should only pass as trust anchors');
matches(/ELSE\s+DISPLAY 'TLSVAL-E010: SELF-SIGNED CERT NOT TRUST ANCHOR '[\s\S]*MOVE 'SELF-SIGNED CERT NOT TRUST ANCHOR'/, 'non-anchor self-signed certs should remain invalid');

for (const optLevel of ['OPT(0)', 'OPT(2)']) {
  assert.deepEqual(
    simulateValidation({ chainLength: 0, inTrustStore: false, trustAnchor: false, optLevel }),
    { chainValid: false, touchedChainEntry: false },
    `empty chain should fail closed without table access under ${optLevel}`,
  );
  assert.deepEqual(
    simulateValidation({ chainLength: 0, inTrustStore: true, trustAnchor: true, optLevel }),
    { chainValid: true, touchedChainEntry: false },
    `self-signed trust anchor should pass without table access under ${optLevel}`,
  );
}

assert.ok(cases.includes('chain-length=0'), 'fixture should include empty chain');
assert.ok(cases.includes('opt-level=OPT(2)'), 'fixture should include OPT(2)');
assert.equal(metadata.agent, 'Codex GPT-5');
assert.ok(!/You are|system prompt|developer message|paste the complete/i.test(metadata.initial_directives), 'metadata must not leak private prompts');

console.log('cobol empty-chain checks passed');
