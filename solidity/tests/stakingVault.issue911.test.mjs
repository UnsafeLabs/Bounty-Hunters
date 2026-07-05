import assert from "node:assert/strict";
import test from "node:test";

const ALICE = "alice";
const ATTACKER = "attacker";

class MockToken {
  constructor() {
    this.balances = new Map();
  }

  mint(account, amount) {
    this.balances.set(account, this.balanceOf(account) + BigInt(amount));
  }

  balanceOf(account) {
    return this.balances.get(account) ?? 0n;
  }

  transfer(from, to, amount) {
    const value = BigInt(amount);
    assert(this.balanceOf(from) >= value, "insufficient token balance");
    this.balances.set(from, this.balanceOf(from) - value);
    this.balances.set(to, this.balanceOf(to) + value);
    return true;
  }
}

class StakingVaultModel {
  constructor(stakingToken, rewardRate = 10n ** 18n) {
    this.stakingToken = stakingToken;
    this.rewardRate = rewardRate;
    this.totalStaked = 0n;
    this.balances = new Map();
    this.rewards = new Map();
    this.lastStakeTime = new Map();
    this.ethBalances = new Map([["vault", 1_000_000n]]);
    this.now = 0n;
    this.entered = false;
    this.events = [];
    this.callbacks = new Map();
  }

  warp(timestamp) {
    this.now = BigInt(timestamp);
  }

  balance(account) {
    return this.balances.get(account) ?? 0n;
  }

  reward(account) {
    return this.rewards.get(account) ?? 0n;
  }

  last(account) {
    return this.lastStakeTime.get(account) ?? 0n;
  }

  eth(account) {
    return this.ethBalances.get(account) ?? 0n;
  }

  setCallback(account, callback) {
    this.callbacks.set(account, callback);
  }

  updateReward(account) {
    if (this.balance(account) > 0n) {
      const timeStaked = this.now - this.last(account);
      this.rewards.set(account, this.reward(account) + (this.balance(account) * timeStaked * this.rewardRate) / (10n ** 18n));
    }
    this.lastStakeTime.set(account, this.now);
  }

  stake(account, amount) {
    amount = BigInt(amount);
    assert(amount > 0n, "Cannot stake 0");
    this.stakingToken.transfer(account, "vault", amount);
    this.updateReward(account);
    this.balances.set(account, this.balance(account) + amount);
    this.totalStaked += amount;
    this.lastStakeTime.set(account, this.now);
    this.events.push(["Staked", account, amount]);
  }

  withdraw(account, amount) {
    amount = BigInt(amount);
    assert(!this.entered, "ReentrancyGuard: reentrant call");
    this.entered = true;
    try {
      assert(this.balance(account) >= amount, "Insufficient balance");
      this.updateReward(account);
      this.balances.set(account, this.balance(account) - amount);
      this.totalStaked -= amount;
      this.transferEth(account, amount);
      this.events.push(["Withdrawn", account, amount]);
    } finally {
      this.entered = false;
    }
  }

  claimRewards(account) {
    assert(!this.entered, "ReentrancyGuard: reentrant call");
    this.entered = true;
    try {
      this.updateReward(account);
      const reward = this.reward(account);
      assert(reward > 0n, "No rewards");
      this.rewards.set(account, 0n);
      this.transferEth(account, reward);
      this.events.push(["RewardClaimed", account, reward]);
    } finally {
      this.entered = false;
    }
  }

  transferEth(account, amount) {
    assert(this.eth("vault") >= amount, "vault eth too low");
    this.ethBalances.set("vault", this.eth("vault") - amount);
    this.ethBalances.set(account, this.eth(account) + amount);
    const callback = this.callbacks.get(account);
    if (callback) {
      callback();
    }
  }

  getPendingRewards(account) {
    const timeStaked = this.now - this.last(account);
    return this.reward(account) + (this.balance(account) * timeStaked * this.rewardRate) / (10n ** 18n);
  }
}

function setup() {
  const token = new MockToken();
  token.mint(ALICE, 1_000n);
  token.mint(ATTACKER, 1_000n);
  return { token, vault: new StakingVaultModel(token) };
}

test("normal staking, withdrawal, and reward claim flows still work", () => {
  const { token, vault } = setup();

  vault.stake(ALICE, 100n);
  vault.warp(10n);
  assert.equal(vault.getPendingRewards(ALICE), 1_000n);
  vault.withdraw(ALICE, 40n);
  vault.claimRewards(ALICE);

  assert.equal(vault.balance(ALICE), 60n);
  assert.equal(vault.totalStaked, 60n);
  assert.equal(token.balanceOf(ALICE), 900n);
  assert(vault.eth(ALICE) > 1_000n);
});

test("withdraw updates state before external callback and blocks reentrancy", () => {
  const { vault } = setup();
  vault.stake(ATTACKER, 100n);
  let reentryBlocked = false;
  vault.setCallback(ATTACKER, () => {
    try {
      vault.withdraw(ATTACKER, 100n);
    } catch (error) {
      reentryBlocked = /reentrant call/.test(error.message);
    }
  });

  vault.withdraw(ATTACKER, 100n);

  assert.equal(reentryBlocked, true);
  assert.equal(vault.balance(ATTACKER), 0n);
  assert.equal(vault.totalStaked, 0n);
});

test("claimRewards clears reward before external callback and blocks reentrancy", () => {
  const { vault } = setup();
  vault.stake(ATTACKER, 50n);
  vault.warp(10n);
  vault.updateReward(ATTACKER);
  let reentryBlocked = false;
  vault.setCallback(ATTACKER, () => {
    try {
      vault.claimRewards(ATTACKER);
    } catch (error) {
      reentryBlocked = /reentrant call/.test(error.message);
    }
  });

  vault.claimRewards(ATTACKER);

  assert.equal(reentryBlocked, true);
  assert.equal(vault.reward(ATTACKER), 0n);
});

test("state is updated before failed external transfer would be observable", () => {
  const { vault } = setup();
  vault.stake(ALICE, 80n);

  vault.withdraw(ALICE, 20n);

  assert.equal(vault.balance(ALICE), 60n);
  assert.equal(vault.totalStaked, 60n);
});
