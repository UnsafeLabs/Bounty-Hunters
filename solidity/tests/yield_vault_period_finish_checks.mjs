import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("solidity/contracts/YieldVault.sol", "utf8");
const contributor = JSON.parse(fs.readFileSync("solidity/contracts/_contributor.json", "utf8"));

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

const lastApplicable = bodyOf("lastTimeRewardApplicable");
const rewardPerToken = bodyOf("rewardPerToken");
const earned = bodyOf("earned");
const notify = bodyOf("notifyRewardAmount");
const deposit = bodyOf("deposit");
const withdraw = bodyOf("withdraw");
const claimReward = bodyOf("claimReward");

assert.match(source, /uint256 private constant PRECISION = 1e18;/, "precision constant must be present");
assert.ok(lastApplicable.includes("block.timestamp < periodFinish ? block.timestamp : periodFinish"), "last applicable time must cap at periodFinish");
assert.ok(rewardPerToken.includes("lastTimeRewardApplicable() - lastUpdateTime"), "rewardPerToken must use capped timestamp");
assert.ok(rewardPerToken.includes("* rewardRate / totalSupply"), "rewardPerToken must use scaled reward rate");
assert.ok(earned.includes("/ PRECISION + rewards[account]"), "earned must divide by precision at withdrawal/accounting time");
assert.ok(source.includes("lastUpdateTime = lastTimeRewardApplicable();"), "updateReward must store capped update time");
assert.ok(notify.includes('require(msg.sender == rewardDistributor, "Not reward distributor");'), "notify must be distributor-only");
assert.ok(notify.includes('require(duration > 0, "Invalid duration");'), "notify must reject zero duration");
assert.ok(notify.includes("leftover = remaining * rewardRate / PRECISION"), "ongoing rewards must preserve scaled leftover");
assert.ok(notify.includes("rewardRate = reward * PRECISION / duration;"), "rewardRate must be scaled to reduce precision loss");
assert.ok(deposit.includes("require(stakingToken.transferFrom"), "deposit must require transfer success");
assert.ok(withdraw.includes("require(stakingToken.transfer"), "withdraw must require transfer success");
assert.ok(claimReward.includes("require(rewardToken.transfer"), "claimReward must require transfer success");
assert.equal(contributor.identity, "Codex GPT-5", "contributor identity must be present");
assert.ok(!/paste verbatim|system message|developer message|secret|credential/i.test(contributor.runtime_instructions), "contributor metadata must not publish hidden instructions");

const PRECISION = 10n ** 18n;

class YieldVaultModel {
  constructor(distributor) {
    this.rewardDistributor = distributor;
    this.rewardRate = 0n;
    this.periodFinish = 0n;
    this.lastUpdateTime = 0n;
    this.rewardPerTokenStored = 0n;
    this.totalSupply = 0n;
    this.balanceOf = new Map();
    this.userRewardPerTokenPaid = new Map();
    this.rewards = new Map();
    this.now = 0n;
  }

  balance(account) {
    return this.balanceOf.get(account) ?? 0n;
  }

  paid(account) {
    return this.userRewardPerTokenPaid.get(account) ?? 0n;
  }

  reward(account) {
    return this.rewards.get(account) ?? 0n;
  }

  warp(timestamp) {
    this.now = BigInt(timestamp);
  }

  lastTimeRewardApplicable() {
    return this.now < this.periodFinish ? this.now : this.periodFinish;
  }

  rewardPerToken() {
    if (this.totalSupply === 0n) return this.rewardPerTokenStored;
    return this.rewardPerTokenStored
      + (this.lastTimeRewardApplicable() - this.lastUpdateTime) * this.rewardRate / this.totalSupply;
  }

  earned(account) {
    return this.balance(account) * (this.rewardPerToken() - this.paid(account)) / PRECISION + this.reward(account);
  }

  updateReward(account) {
    this.rewardPerTokenStored = this.rewardPerToken();
    this.lastUpdateTime = this.lastTimeRewardApplicable();
    if (account) {
      this.rewards.set(account, this.earned(account));
      this.userRewardPerTokenPaid.set(account, this.rewardPerTokenStored);
    }
  }

  notifyRewardAmount(caller, reward, duration) {
    this.updateReward(null);
    assert.equal(caller, this.rewardDistributor, "Not reward distributor");
    assert.ok(duration > 0n, "Invalid duration");
    let totalReward = reward;
    if (this.now < this.periodFinish) {
      totalReward += (this.periodFinish - this.now) * this.rewardRate / PRECISION;
    }
    this.rewardRate = totalReward * PRECISION / duration;
    this.lastUpdateTime = this.now;
    this.periodFinish = this.now + duration;
  }

  deposit(account, amount) {
    this.updateReward(account);
    this.totalSupply += amount;
    this.balanceOf.set(account, this.balance(account) + amount);
  }

  withdraw(account, amount) {
    this.updateReward(account);
    this.totalSupply -= amount;
    this.balanceOf.set(account, this.balance(account) - amount);
  }

  claimReward(account) {
    this.updateReward(account);
    const reward = this.reward(account);
    this.rewards.set(account, 0n);
    return reward;
  }
}

const vault = new YieldVaultModel("distributor");
assert.throws(() => vault.notifyRewardAmount("attacker", 1000n, 100n), /Not reward distributor/, "unauthorized notify must fail");

vault.deposit("alice", 100n);
vault.notifyRewardAmount("distributor", 1000n, 100n);
vault.warp(40n);
assert.equal(vault.earned("alice"), 400n, "reward must accrue during the active period");

vault.warp(100n);
const atFinish = vault.earned("alice");
assert.equal(atFinish, 1000n, "full reward must be earned at period finish");

vault.warp(150n);
assert.equal(vault.earned("alice"), atFinish, "earned must freeze after period expiry");
assert.equal(vault.rewardPerToken(), vault.rewardPerTokenStored + 100n * vault.rewardRate / vault.totalSupply, "rewardPerToken must cap at periodFinish");

const claimed = vault.claimReward("alice");
assert.equal(claimed, 1000n, "claim flow must pay accrued reward");
vault.withdraw("alice", 100n);
assert.equal(vault.totalSupply, 0n, "withdraw flow must preserve accounting");

const precisionVault = new YieldVaultModel("distributor");
precisionVault.deposit("alice", 1n);
const precisionReward = 1000n * PRECISION;
precisionVault.notifyRewardAmount("distributor", precisionReward, 333n);
precisionVault.warp(333n);
const precisionEarned = precisionVault.earned("alice");
const precisionErrorBps = Number((precisionReward - precisionEarned) * 10000n / precisionReward);
assert.ok(precisionErrorBps < 1, "precision loss must be less than 0.01%");

console.log("YieldVault period-finish checks passed: accrual, expiry freeze, distributor access, precision, claim, and withdraw flows.");
