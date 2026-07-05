import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const solidityRoot = join(__dirname, "..");
const sourcePath = join(solidityRoot, "contracts", "TokenVesting.sol");
const auditPath = join(solidityRoot, ".audit.json");
const demoPath = join(solidityRoot, "demos", "issue-917-tokenvesting-demo.gif");

const source = readFileSync(sourcePath, "utf8");

function assertSourceDoesNotContain(name, pattern) {
  assert.equal(
    pattern.test(source),
    false,
    `${name}: forbidden source pattern is still present`,
  );
}

function assertSourceContains(name, pattern) {
  assert.match(source, pattern, `${name}: expected source pattern missing`);
}

function preciseLinearVesting(totalAllocation, duration, elapsed) {
  if (elapsed >= duration) return totalAllocation;
  const wholeTokensPerSecond = totalAllocation / duration;
  const remainder = totalAllocation % duration;
  return wholeTokensPerSecond * elapsed + (remainder * elapsed) / duration;
}

function expectedUnvested(totalAllocation, vested, claimed) {
  const beneficiaryObligation = vested > claimed ? vested : claimed;
  return totalAllocation - beneficiaryObligation;
}

function assertWithinOneUnit(actual, expected, label) {
  const diff = actual > expected ? actual - expected : expected - actual;
  assert.ok(diff <= 1n, `${label}: ${actual} differs from ${expected} by ${diff}`);
}

assertSourceDoesNotContain(
  "overflow-prone vesting multiplication",
  /totalAllocation\s*\*\s*elapsed\s*\/\s*duration/,
);
assertSourceDoesNotContain(
  "completion check that can overflow start + duration",
  /block\.timestamp\s*>=\s*start\s*\+\s*duration/,
);
assertSourceDoesNotContain(
  "revocation based only on vested amount",
  /uint256\s+unvested\s*=\s*totalAllocation\s*-\s*vested\s*;/,
);

assertSourceContains(
  "division before multiplication for main vesting term",
  /totalAllocation\s*\/\s*duration/,
);
assertSourceContains(
  "remainder preservation for truncated allocation",
  /totalAllocation\s*%\s*duration/,
);
assertSourceContains(
  "duration-based completion guard",
  /elapsed\s*>=\s*duration/,
);
assertSourceContains(
  "claim blocked after revocation",
  /require\s*\(\s*!revoked\s*,\s*"Vesting revoked"\s*\)/,
);
assertSourceContains(
  "revocation preserves already claimed or vested beneficiary obligation",
  /uint256\s+beneficiaryObligation\s*=\s*vested\s*>\s*claimed\s*\?\s*vested\s*:\s*claimed\s*;/,
);
assertSourceContains(
  "owner receives only truly unvested amount",
  /uint256\s+unvested\s*=\s*totalAllocation\s*-\s*beneficiaryObligation\s*;/,
);
assertSourceContains(
  "beneficiary transfer return value checked",
  /require\s*\(\s*token\.transfer\s*\(\s*beneficiary\s*,\s*amount\s*\)\s*,\s*"Token transfer failed"\s*\)/,
);
assertSourceContains(
  "owner transfer return value checked",
  /require\s*\(\s*token\.transfer\s*\(\s*owner\s*,\s*unvested\s*\)\s*,\s*"Token transfer failed"\s*\)/,
);

const oneBillionTokens = 1_000_000_000n * 10n ** 18n;
const duration = 365n * 24n * 60n * 60n;
const sampleElapsed = 123n * 24n * 60n * 60n + 4567n;
const precise = preciseLinearVesting(oneBillionTokens, duration, sampleElapsed);
const mathematical = (oneBillionTokens * sampleElapsed) / duration;

assertWithinOneUnit(precise, mathematical, "linear curve accuracy");
assert.equal(
  preciseLinearVesting(oneBillionTokens, duration, duration),
  oneBillionTokens,
  "full vesting returns the complete allocation",
);

const oddAllocation = 1_000_000_000n * 10n ** 18n + 17n;
assert.equal(
  preciseLinearVesting(oddAllocation, 31_536_001n, 31_536_001n),
  oddAllocation,
  "remainder handling preserves every token unit at completion",
);

assert.equal(
  expectedUnvested(oneBillionTokens, 0n, 0n),
  oneBillionTokens,
  "cliff revocation returns total allocation when nothing was claimed",
);
assert.equal(
  expectedUnvested(oneBillionTokens, 0n, 99n),
  oneBillionTokens - 99n,
  "cliff revocation subtracts already claimed amounts",
);
const vestedAfterCliff = preciseLinearVesting(oneBillionTokens, duration, duration / 4n);
assert.equal(
  expectedUnvested(oneBillionTokens, vestedAfterCliff, vestedAfterCliff / 2n),
  oneBillionTokens - vestedAfterCliff,
  "post-cliff revocation returns only unvested tokens",
);

assert.ok(existsSync(auditPath), ".audit.json must be present in the solidity directory");
const audit = JSON.parse(readFileSync(auditPath, "utf8"));
assert.equal(audit.contributor, "OpenAI Codex");
assert.match(audit.completed_at, /^\d{4}-\d{2}-\d{2}T/);
assert.match(audit.environment_config, /safe public/i);
assert.doesNotMatch(audit.environment_config, /hidden system|developer instruction|secret|token/i);
assert.ok(existsSync(demoPath), "demo GIF must be present for the bounty claim");

console.log("TokenVesting issue #917 checks passed");
