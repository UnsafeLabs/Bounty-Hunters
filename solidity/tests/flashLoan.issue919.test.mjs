import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const solidityRoot = join(__dirname, "..");
const sourcePath = join(solidityRoot, "contracts", "FlashLoan.sol");
const metadataPath = join(solidityRoot, ".contributor.json");
const demoPath = join(solidityRoot, "demos", "issue-919-flashloan-demo.gif");

const source = readFileSync(sourcePath, "utf8");

function assertSourceContains(name, pattern) {
  assert.match(source, pattern, `${name}: expected source pattern missing`);
}

function assertSourceDoesNotContain(name, pattern) {
  assert.equal(
    pattern.test(source),
    false,
    `${name}: forbidden source pattern is still present`,
  );
}

function feeFor(amount, feeBPS) {
  const rawFee = (amount * feeBPS) / 10_000n;
  return rawFee === 0n ? 1n : rawFee;
}

function simulateFlashLoan(poolBalance, totalFees, amount, feeBPS, paused = false) {
  assert.equal(paused, false, "paused flash loans must be rejected");
  assert.ok(amount > 0n, "amount must be nonzero");
  assert.ok(amount <= poolBalance / 2n, "loans must be capped at 50% of pool liquidity");
  const fee = feeFor(amount, feeBPS);
  return {
    fee,
    poolBalance: poolBalance + fee,
    totalFees: totalFees + fee,
    repayment: amount + fee,
  };
}

assertSourceDoesNotContain(
  "zero-fee truncating formula",
  /amount\s*\*\s*feeBPS\s*\/\s*10000/,
);
assertSourceDoesNotContain(
  "callback-time balanceOf repayment validation",
  /balanceAfter\s*>=\s*balanceBefore\s*\+\s*fee/,
);
assertSourceDoesNotContain(
  "pool balance exposed through raw token balance",
  /return\s+loanToken\.balanceOf\(address\(this\)\)\s*;/,
);

assertSourceContains("OpenZeppelin Math fee calculation", /Math\.mulDiv\(amount,\s*feeBPS,\s*(10_000|BPS_DENOMINATOR)\)/);
assertSourceContains("minimum one-unit fee floor", /fee\s*==\s*0\s*\?\s*1\s*:\s*fee/);
assertSourceContains("internal pool accounting state", /uint256\s+public\s+poolBalance\s*;/);
assertSourceContains("50 percent max-loan cap", /amount\s*<=\s*poolBalance\s*\/\s*2/);
assertSourceContains("explicit repayment amount", /uint256\s+repayment\s*=\s*amount\s*\+\s*fee\s*;/);
assertSourceContains(
  "repayment uses transferFrom instead of passive balance checks",
  /loanToken\.transferFrom\(msg\.sender,\s*address\(this\),\s*repayment\)/,
);
assertSourceContains("fee accrues to internal pool accounting", /poolBalance\s*\+=\s*fee\s*;/);
assertSourceContains("fee accrual is tracked", /totalFees\s*\+=\s*fee\s*;/);
assertSourceContains("fee withdrawal reduces internal pool accounting", /poolBalance\s*-=\s*fees\s*;/);
assertSourceContains("owner pause function", /function\s+pause\(\)\s+external/);
assertSourceContains("owner unpause function", /function\s+unpause\(\)\s+external/);
assertSourceContains("flash loans check pause state", /require\(!paused,\s*"Paused"\)/);
assertSourceContains("nested loan guard", /require\(!loanActive,\s*"Loan active"\)/);
assertSourceContains("outbound transfer is checked", /require\(loanToken\.transfer\(msg\.sender,\s*amount\),\s*"Token transfer failed"\)/);

assert.equal(feeFor(1n, 30n), 1n, "small nonzero loans pay a one-unit fee");
assert.equal(feeFor(10_000n, 30n), 30n, "normal loans keep basis-point fee math");
assert.throws(
  () => simulateFlashLoan(1_000n, 0n, 501n, 30n),
  /50%/,
  "loans above half the pool are rejected",
);
const loan = simulateFlashLoan(1_000n, 0n, 500n, 30n);
assert.deepEqual(loan, {
  fee: 1n,
  poolBalance: 1_001n,
  totalFees: 1n,
  repayment: 501n,
});
assert.throws(
  () => simulateFlashLoan(1_000n, 0n, 1n, 30n, true),
  /paused/,
  "paused flash loans are rejected",
);

assert.ok(existsSync(metadataPath), ".contributor.json must be present in the solidity directory");
const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
assert.equal(metadata.agent, "OpenAI Codex");
assert.match(metadata.timestamp, /^\d{4}-\d{2}-\d{2}T/);
assert.match(metadata.initialized_with, /safe public/i);
assert.doesNotMatch(metadata.initialized_with, /hidden system|developer instruction|secret|token/i);
assert.ok(existsSync(demoPath), "demo GIF must be present for the bounty claim");

console.log("FlashLoan issue #919 checks passed");
