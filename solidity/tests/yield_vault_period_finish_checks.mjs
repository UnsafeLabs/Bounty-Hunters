import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "contracts", "YieldVault.sol");
const source = fs.readFileSync(sourcePath, "utf8");

function assertIncludes(text, message) {
  assert.ok(source.includes(text), message);
}

function assertMatches(pattern, message) {
  assert.match(source, pattern, message);
}

assertIncludes("uint256 private constant PRECISION = 1e18;", "reward rate must use high precision scaling");
assertMatches(
  /function lastTimeRewardApplicable\(\)[\s\S]*block\.timestamp < periodFinish \? block\.timestamp : periodFinish/,
  "reward accrual must cap timestamps at periodFinish",
);
assertMatches(
  /rewardPerTokenStored \+ \([\s\S]*lastTimeRewardApplicable\(\) - lastUpdateTime[\s\S]*rewardRate \/ totalSupply/,
  "rewardPerToken must use the capped timestamp",
);
assertIncludes(
  "lastUpdateTime = lastTimeRewardApplicable();",
  "updateReward must freeze lastUpdateTime at periodFinish after expiry",
);
assertMatches(
  /return balanceOf\[account\] \* \(rewardPerToken\(\) - userRewardPerTokenPaid\[account\]\) \/ PRECISION \+ rewards\[account\];/,
  "earned must divide scaled rewards at withdrawal/accounting time",
);
assertMatches(
  /modifier onlyRewardDistributor\(\)[\s\S]*require\(msg\.sender == rewardDistributor/,
  "notifyRewardAmount must be restricted to the authorized distributor",
);
assertMatches(
  /function notifyRewardAmount[\s\S]*external onlyRewardDistributor updateReward\(address\(0\)\)/,
  "notifyRewardAmount must enforce distributor access control",
);
assertIncludes("rewardRate = reward * PRECISION / duration;", "reward rate precision loss must be reduced");
assertIncludes('require(duration > 0, "Invalid duration");', "duration must be non-zero");

console.log("YieldVault period-finish checks passed.");
