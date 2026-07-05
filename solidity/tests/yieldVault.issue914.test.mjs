import assert from "node:assert/strict";
import test from "node:test";

const SCALE = 10n ** 18n;
const DISTRIBUTOR = "distributor";
const ALICE = "alice";
const BOB = "bob";
const EVE = "eve";

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

class YieldVaultModel {
  constructor(stakingToken, rewardToken, distributor = DISTRIBUTOR) {
    this.stakingToken = stakingToken;
    this.rewardToken = rewardToken;
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
    this.events = [];
  }

  warp(timestamp) {
    this.now = BigInt(timestamp);
  }

  balance(account) {
    return this.balanceOf.get(account) ?? 0n;
  }

  paid(account) {
    return this.userRewardPerTokenPaid.get(account) ?? 0n;
  }

  accrued(account) {
    return this.rewards.get(account) ?? 0n;
  }

  lastTimeRewardApplicable() {
    return this.now < this.periodFinish ? this.now : this.periodFinish;
  }

  rewardPerToken() {
    if (this.totalSupply === 0n) {
      return this.rewardPerTokenStored;
    }

    return this.rewardPerTokenStored
      + ((this.lastTimeRewardApplicable() - this.lastUpdateTime) * this.rewardRate) / this.totalSupply;
  }

  earned(account) {
    return (this.balance(account) * (this.rewardPerToken() - this.paid(account))) / SCALE
      + this.accrued(account);
  }

  updateReward(account = null) {
    this.rewardPerTokenStored = this.rewardPerToken();
    this.lastUpdateTime = this.lastTimeRewardApplicable();
    if (account !== null) {
      this.rewards.set(account, this.earned(account));
      this.userRewardPerTokenPaid.set(account, this.rewardPerTokenStored);
    }
  }

  notifyRewardAmount(sender, reward, duration) {
    assert(sender === this.rewardDistributor, "Not reward distributor");
    duration = BigInt(duration);
    reward = BigInt(reward);
    assert(duration > 0n, "Invalid duration");
    this.updateReward(null);

    let rewardWithRemainder = reward;
    if (this.now < this.periodFinish) {
      const remaining = this.periodFinish - this.now;
      rewardWithRemainder += (remaining * this.rewardRate) / SCALE;
    }

    this.rewardRate = (rewardWithRemainder * SCALE) / duration;
    this.lastUpdateTime = this.now;
    this.periodFinish = this.now + duration;
  }

  deposit(account, amount) {
    amount = BigInt(amount);
    assert(amount > 0n, "Cannot deposit 0");
    this.updateReward(account);
    this.totalSupply += amount;
    this.balanceOf.set(account, this.balance(account) + amount);
    this.stakingToken.transfer(account, "vault", amount);
    this.events.push(["Deposited", account, amount]);
  }

  withdraw(account, amount) {
    amount = BigInt(amount);
    assert(amount > 0n, "Cannot withdraw 0");
    this.updateReward(account);
    this.totalSupply -= amount;
    this.balanceOf.set(account, this.balance(account) - amount);
    this.stakingToken.transfer("vault", account, amount);
    this.events.push(["Withdrawn", account, amount]);
  }

  claimReward(account) {
    this.updateReward(account);
    const reward = this.accrued(account);
    if (reward > 0n) {
      this.rewards.set(account, 0n);
      this.rewardToken.transfer("vault", account, reward);
      this.events.push(["RewardPaid", account, reward]);
    }
    return reward;
  }
}

function setup() {
  const stakingToken = new MockToken();
  const rewardToken = new MockToken();
  for (const account of [ALICE, BOB, EVE]) {
    stakingToken.mint(account, 1_000_000n);
  }
  rewardToken.mint("vault", 10_000_000n);
  return { vault: new YieldVaultModel(stakingToken, rewardToken), stakingToken, rewardToken };
}

test("rewards accrue during the active period", () => {
  const { vault } = setup();

  vault.deposit(ALICE, 100n);
  vault.notifyRewardAmount(DISTRIBUTOR, 1_000n, 100n);
  vault.warp(50n);

  assert.equal(vault.rewardPerToken(), 5n * SCALE);
  assert.equal(vault.earned(ALICE), 500n);
});

test("rewardPerToken and earned freeze after period expiry", () => {
  const { vault } = setup();

  vault.deposit(ALICE, 100n);
  vault.notifyRewardAmount(DISTRIBUTOR, 1_000n, 100n);
  vault.warp(100n);
  const earnedAtFinish = vault.earned(ALICE);
  const rewardPerTokenAtFinish = vault.rewardPerToken();

  vault.warp(1_000n);

  assert.equal(vault.earned(ALICE), earnedAtFinish);
  assert.equal(vault.rewardPerToken(), rewardPerTokenAtFinish);
});

test("new deposits after reward expiry do not earn phantom rewards", () => {
  const { vault } = setup();

  vault.deposit(ALICE, 100n);
  vault.notifyRewardAmount(DISTRIBUTOR, 1_000n, 100n);
  vault.warp(150n);
  vault.deposit(BOB, 100n);
  vault.warp(300n);

  assert.equal(vault.earned(BOB), 0n);
});

test("only the authorized distributor can notify rewards", () => {
  const { vault } = setup();

  assert.throws(() => vault.notifyRewardAmount(EVE, 1_000n, 100n), /Not reward distributor/);
});

test("scaled reward rate keeps precision error below 0.01 percent", () => {
  const { vault } = setup();
  const reward = 1_000_000n;

  vault.deposit(ALICE, 1n);
  vault.notifyRewardAmount(DISTRIBUTOR, reward, 3n);
  vault.warp(3n);

  const paid = vault.earned(ALICE);
  const error = reward - paid;
  assert(error * 10_000n < reward);
});

test("deposit, withdrawal, and reward claim flows still function", () => {
  const { vault, rewardToken, stakingToken } = setup();

  vault.deposit(ALICE, 100n);
  vault.notifyRewardAmount(DISTRIBUTOR, 1_000n, 100n);
  vault.warp(25n);
  vault.withdraw(ALICE, 40n);
  vault.warp(50n);
  const reward = vault.claimReward(ALICE);

  assert(reward > 0n);
  assert.equal(rewardToken.balanceOf(ALICE), reward);
  assert.equal(stakingToken.balanceOf(ALICE), 999_940n);
});
