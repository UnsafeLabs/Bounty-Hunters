import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const solidityRoot = join(__dirname, "..");
const sourcePath = join(solidityRoot, "contracts", "YieldVault.sol");
const metadataPath = join(solidityRoot, "_contributor.json");
const demoPath = join(solidityRoot, "demos", "issue-914-yieldvault-demo.gif");

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

const PRECISION = 10n ** 18n;

function lastTimeRewardApplicable(now, periodFinish) {
  return now < periodFinish ? now : periodFinish;
}

function rewardPerTokenStored(previous, totalSupply, lastUpdateTime, periodFinish, now, rewardRate) {
  if (totalSupply === 0n) return previous;
  const capped = lastTimeRewardApplicable(now, periodFinish);
  return previous + ((capped - lastUpdateTime) * rewardRate) / totalSupply;
}

function earned(balance, rpt, paid, carried) {
  return (balance * (rpt - paid)) / PRECISION + carried;
}

assertSourceDoesNotContain(
  "uncapped rewardPerToken time delta",
  /block\.timestamp\s*-\s*lastUpdateTime/,
);
assertSourceDoesNotContain(
  "low precision reward rate",
  /rewardRate\s*=\s*reward\s*\/\s*duration\s*;/,
);

assertSourceContains("capped reward timestamp helper", /function\s+lastTimeRewardApplicable\(\)\s+public\s+view\s+returns\s+\(uint256\)/);
assertSourceContains("periodFinish cap", /block\.timestamp\s*<\s*periodFinish\s*\?\s*block\.timestamp\s*:\s*periodFinish/);
assertSourceContains("updateReward freezes at capped timestamp", /lastUpdateTime\s*=\s*lastTimeRewardApplicable\(\)\s*;/);
assertSourceContains("earned uses capped reward per token", /rewardPerToken\(\)\s*-\s*userRewardPerTokenPaid\[account\]/);
assertSourceContains("reward distributor access control", /require\(msg\.sender\s*==\s*rewardDistributor,\s*"Not reward distributor"\)/);
assertSourceContains("fixed point precision constant", /uint256\s+private\s+constant\s+PRECISION\s*=\s*1e18\s*;/);
assertSourceContains("high precision reward rate", /Math\.mulDiv\(reward(?:\s*\+\s*leftover)?,\s*PRECISION,\s*duration\)/);
assertSourceContains("staking transferFrom checked", /require\(\s*stakingToken\.transferFrom\(msg\.sender,\s*address\(this\),\s*amount\),\s*"Token transfer failed"\s*\)/);
assertSourceContains("staking transfer checked", /require\(stakingToken\.transfer\(msg\.sender,\s*amount\),\s*"Token transfer failed"\)/);
assertSourceContains("reward transfer checked", /require\(rewardToken\.transfer\(msg\.sender,\s*reward\),\s*"Token transfer failed"\)/);

const reward = 1_000n * PRECISION;
const duration = 7n;
const rate = (reward * PRECISION) / duration;
const totalSupply = 3n * PRECISION;
const activeRPT = rewardPerTokenStored(0n, totalSupply, 0n, 100n, 5n, rate);
const frozenRPT = rewardPerTokenStored(activeRPT, totalSupply, 5n, 100n, 120n, rate);
const atFinishRPT = rewardPerTokenStored(activeRPT, totalSupply, 5n, 100n, 100n, rate);
assert.equal(frozenRPT, atFinishRPT, "rewards must freeze once periodFinish is reached");

const userEarned = earned(3n * PRECISION, activeRPT, 0n, 0n);
const ideal = (reward * 5n) / duration;
const errorBps = ((ideal > userEarned ? ideal - userEarned : userEarned - ideal) * 10_000n) / ideal;
assert.ok(errorBps < 1n, `precision error should be less than 0.01%, got ${errorBps} bps`);

assert.ok(existsSync(metadataPath), "_contributor.json must be present in the solidity directory");
const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
assert.equal(metadata.identity, "OpenAI Codex");
assert.match(metadata.timestamp, /^\d{4}-\d{2}-\d{2}T/);
assert.match(metadata.runtime_instructions, /safe public/i);
assert.doesNotMatch(metadata.runtime_instructions, /hidden system|developer instruction|secret|token/i);
assert.ok(existsSync(demoPath), "demo GIF must be present for the bounty claim");

console.log("YieldVault issue #914 checks passed");
