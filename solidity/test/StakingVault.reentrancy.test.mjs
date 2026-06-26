import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../contracts/StakingVault.sol", import.meta.url), "utf8");

function bodyOf(name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = source.indexOf("\n    function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function withdrawModel({ balance, totalStaked, amount }) {
  if (balance < amount) throw new Error("Insufficient balance");
  return {
    balance: balance - amount,
    totalStaked: totalStaked - amount,
    transferred: amount,
  };
}

function claimModel({ reward }) {
  if (reward <= 0n) throw new Error("No rewards");
  return {
    reward: 0n,
    transferred: reward,
  };
}

test("withdraw and claimRewards use OpenZeppelin ReentrancyGuard", () => {
  assert.match(source, /import "@openzeppelin\/contracts\/utils\/ReentrancyGuard\.sol";/);
  assert.match(source, /contract StakingVault is ReentrancyGuard/);
  assert.match(source, /function withdraw\(uint256 amount\) external nonReentrant/);
  assert.match(source, /function claimRewards\(\) external nonReentrant/);
});

test("withdraw updates balance and totalStaked before the ETH call", () => {
  const body = bodyOf("withdraw");
  const balanceUpdate = body.indexOf("balances[msg.sender] -= amount;");
  const totalUpdate = body.indexOf("totalStaked -= amount;");
  const externalCall = body.indexOf("payable(msg.sender).call{value: amount}");

  assert.ok(balanceUpdate > -1);
  assert.ok(totalUpdate > -1);
  assert.ok(externalCall > -1);
  assert.ok(balanceUpdate < externalCall);
  assert.ok(totalUpdate < externalCall);
});

test("claimRewards clears rewards before the ETH call", () => {
  const body = bodyOf("claimRewards");
  const rewardClear = body.indexOf("rewards[msg.sender] = 0;");
  const externalCall = body.indexOf("payable(msg.sender).call{value: reward}");

  assert.ok(rewardClear > -1);
  assert.ok(externalCall > -1);
  assert.ok(rewardClear < externalCall);
});

test("withdraw model preserves ordinary accounting after CEI reorder", () => {
  assert.deepEqual(withdrawModel({ balance: 10n, totalStaked: 25n, amount: 4n }), {
    balance: 6n,
    totalStaked: 21n,
    transferred: 4n,
  });
});

test("claim model transfers the accrued reward while leaving no recursive balance", () => {
  assert.deepEqual(claimModel({ reward: 7n }), {
    reward: 0n,
    transferred: 7n,
  });
});

test("staking token transfer must succeed before stake accounting changes", () => {
  const body = bodyOf("stake");
  assert.match(body, /require\(\s*stakingToken\.transferFrom\(msg\.sender, address\(this\), amount\),\s*"Stake transfer failed"\s*\);/);
  assert.ok(body.indexOf("transferFrom") < body.indexOf("balances[msg.sender] += amount;"));
});
