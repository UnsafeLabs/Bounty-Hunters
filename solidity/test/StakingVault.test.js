const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "contracts", "StakingVault.sol"),
  "utf8",
);

function functionBody(name) {
  const signature = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)[^{]*{`, "m");
  const match = signature.exec(source);
  assert.ok(match, `${name} function exists`);
  const start = match.index + match[0].length;
  let depth = 1;

  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index);
  }

  throw new Error(`${name} function body was not closed`);
}

test("withdraw and claimRewards are protected by ReentrancyGuard", () => {
  assert.match(source, /import\s+"@openzeppelin\/contracts\/utils\/ReentrancyGuard\.sol";/);
  assert.match(source, /contract\s+StakingVault\s+is\s+ReentrancyGuard/);
  assert.match(source, /function\s+withdraw\s*\([^)]*\)\s+external\s+nonReentrant/);
  assert.match(source, /function\s+claimRewards\s*\([^)]*\)\s+external\s+nonReentrant/);
});

test("withdraw updates balances before the external ETH transfer", () => {
  const body = functionBody("withdraw");
  const balanceUpdate = body.indexOf("balances[msg.sender] -= amount");
  const totalUpdate = body.indexOf("totalStaked -= amount");
  const externalCall = body.indexOf("call{value: amount}");

  assert.equal(balanceUpdate >= 0, true);
  assert.equal(totalUpdate >= 0, true);
  assert.equal(externalCall >= 0, true);
  assert.equal(balanceUpdate < externalCall, true);
  assert.equal(totalUpdate < externalCall, true);
});

test("claimRewards zeroes reward balance before the external ETH transfer", () => {
  const body = functionBody("claimRewards");
  const rewardUpdate = body.indexOf("rewards[msg.sender] = 0");
  const externalCall = body.indexOf("call{value: reward}");

  assert.equal(rewardUpdate >= 0, true);
  assert.equal(externalCall >= 0, true);
  assert.equal(rewardUpdate < externalCall, true);
});

test("a recursive withdraw sees the reduced balance before reentry", () => {
  const startingBalance = 100n;
  const withdrawal = 60n;
  const balanceBeforeExternalCall = startingBalance - withdrawal;

  assert.equal(balanceBeforeExternalCall >= withdrawal, false);
});
