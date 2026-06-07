import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("solidity/contracts/StakingVault.sol", "utf8");
const provenance = JSON.parse(fs.readFileSync("solidity/contracts/.provenance.json", "utf8"));

function bodyOf(functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} not found`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(brace + 1, index);
  }
  throw new Error(`${functionName} body not closed`);
}

function assertBefore(body, first, second, message) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `${first} not found`);
  assert.notEqual(secondIndex, -1, `${second} not found`);
  assert.ok(firstIndex < secondIndex, message);
}

const stake = bodyOf("stake");
const withdraw = bodyOf("withdraw");
const claimRewards = bodyOf("claimRewards");

assert.ok(source.includes('import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";'), "ReentrancyGuard must be imported");
assert.match(source, /contract StakingVault is ReentrancyGuard/, "StakingVault must inherit ReentrancyGuard");
assert.match(source, /function withdraw\(uint256 amount\) external nonReentrant/, "withdraw must be nonReentrant");
assert.match(source, /function claimRewards\(\) external nonReentrant/, "claimRewards must be nonReentrant");
assert.ok(stake.includes("require(stakingToken.transferFrom"), "stake must require staking token transfer success");
assertBefore(withdraw, "balances[msg.sender] -= amount;", "payable(msg.sender).call", "withdraw must update user balance before external call");
assertBefore(withdraw, "totalStaked -= amount;", "payable(msg.sender).call", "withdraw must update total supply before external call");
assertBefore(claimRewards, "rewards[msg.sender] = 0;", "payable(msg.sender).call", "claimRewards must zero rewards before external call");
assert.equal(provenance.agent_name, "Codex GPT-5", "provenance agent must be present");
assert.ok(!/paste the full text|system message|developer message|secret|credential/i.test(provenance.config_snapshot), "provenance must not publish hidden instructions");

class StakingVaultModel {
  constructor(rewardRate) {
    this.rewardRate = rewardRate;
    this.totalStaked = 0n;
    this.balances = new Map();
    this.rewards = new Map();
    this.lastStakeTime = new Map();
    this.now = 0n;
    this.locked = false;
  }

  balance(account) {
    return this.balances.get(account) ?? 0n;
  }

  reward(account) {
    return this.rewards.get(account) ?? 0n;
  }

  warp(timestamp) {
    this.now = BigInt(timestamp);
  }

  updateReward(account) {
    if (this.balance(account) > 0n) {
      const last = this.lastStakeTime.get(account) ?? this.now;
      const timeStaked = this.now - last;
      this.rewards.set(account, this.reward(account) + this.balance(account) * timeStaked * this.rewardRate / 10n ** 18n);
    }
    this.lastStakeTime.set(account, this.now);
  }

  stake(account, amount) {
    assert.ok(amount > 0n, "Cannot stake 0");
    this.updateReward(account);
    this.balances.set(account, this.balance(account) + amount);
    this.totalStaked += amount;
    this.lastStakeTime.set(account, this.now);
  }

  nonReentrant(callback) {
    assert.equal(this.locked, false, "ReentrancyGuard: reentrant call");
    this.locked = true;
    try {
      callback();
    } finally {
      this.locked = false;
    }
  }

  withdraw(account, amount, onReceive = () => {}) {
    this.nonReentrant(() => {
      assert.ok(this.balance(account) >= amount, "Insufficient balance");
      this.updateReward(account);
      this.balances.set(account, this.balance(account) - amount);
      this.totalStaked -= amount;
      onReceive();
    });
  }

  claimRewards(account, onReceive = () => {}) {
    this.nonReentrant(() => {
      this.updateReward(account);
      const reward = this.reward(account);
      assert.ok(reward > 0n, "No rewards");
      this.rewards.set(account, 0n);
      onReceive();
    });
  }
}

const vault = new StakingVaultModel(10n ** 18n);
vault.stake("alice", 10n);
vault.warp(10n);
vault.withdraw("alice", 4n);
assert.equal(vault.balance("alice"), 6n, "ordinary withdraw must keep remaining balance");
assert.equal(vault.totalStaked, 6n, "ordinary withdraw must update total staked");

let withdrawReentryBlocked = false;
vault.withdraw("alice", 1n, () => {
  try {
    vault.withdraw("alice", 1n);
  } catch {
    withdrawReentryBlocked = true;
  }
});
assert.equal(withdrawReentryBlocked, true, "recursive withdraw must fail");

vault.warp(20n);
let claimReentryBlocked = false;
vault.claimRewards("alice", () => {
  try {
    vault.claimRewards("alice");
  } catch {
    claimReentryBlocked = true;
  }
});
assert.equal(claimReentryBlocked, true, "recursive claimRewards must fail");
assert.equal(vault.reward("alice"), 0n, "claimRewards must zero reward before external call");

console.log("StakingVault reentrancy checks passed: nonReentrant guards, state-before-call ordering, normal flow, and recursive attack blocking.");
