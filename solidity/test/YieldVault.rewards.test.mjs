import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../contracts/YieldVault.sol", import.meta.url), "utf8");
const PRECISION = 10n ** 18n;

function rewardRate({ reward, duration }) {
  return (reward * PRECISION) / duration;
}

function lastTimeRewardApplicable({ now, periodFinish }) {
  return now < periodFinish ? now : periodFinish;
}

function rewardPerToken({ stored = 0n, now, periodFinish, lastUpdateTime, rate, totalSupply }) {
  if (totalSupply === 0n) return stored;

  const applicableTime = lastTimeRewardApplicable({ now, periodFinish });
  if (applicableTime <= lastUpdateTime) return stored;

  return stored + ((applicableTime - lastUpdateTime) * rate) / totalSupply;
}

function earned({ balance, paid = 0n, rewards = 0n, rpt }) {
  return (balance * (rpt - paid)) / PRECISION + rewards;
}

function notifyModel({ sender, distributor, reward, duration }) {
  if (sender !== distributor) throw new Error("Not reward distributor");
  if (duration <= 0n) throw new Error("Duration must be > 0");
  return rewardRate({ reward, duration });
}

test("rewardPerToken caps accrual at periodFinish", () => {
  assert.match(source, /function lastTimeRewardApplicable\(\) public view returns \(uint256\)/);
  assert.match(source, /block\.timestamp < periodFinish \? block\.timestamp : periodFinish/);
  assert.match(source, /uint256 applicableTime = lastTimeRewardApplicable\(\);/);
  assert.match(source, /lastUpdateTime = lastTimeRewardApplicable\(\);/);
});

test("earned uses capped rewardPerToken with scaled precision", () => {
  assert.match(source, /uint256 private constant PRECISION = 1e18;/);
  assert.match(source, /Math\.mulDiv\(\s*balanceOf\[account\],\s*rewardPerToken\(\) - userRewardPerTokenPaid\[account\],\s*PRECISION\s*\)/);
});

test("reward accrues during an active period", () => {
  const rate = rewardRate({ reward: 1_000n * PRECISION, duration: 100n });
  const rpt = rewardPerToken({
    now: 50n,
    periodFinish: 100n,
    lastUpdateTime: 0n,
    rate,
    totalSupply: 100n * PRECISION,
  });

  assert.equal(earned({ balance: 100n * PRECISION, rpt }), 500n * PRECISION);
});

test("reward freezes after period expiry", () => {
  const rate = rewardRate({ reward: 1_000n * PRECISION, duration: 100n });
  const atFinish = rewardPerToken({
    now: 100n,
    periodFinish: 100n,
    lastUpdateTime: 0n,
    rate,
    totalSupply: 100n * PRECISION,
  });
  const afterFinish = rewardPerToken({
    now: 150n,
    periodFinish: 100n,
    lastUpdateTime: 0n,
    rate,
    totalSupply: 100n * PRECISION,
  });

  assert.equal(afterFinish, atFinish);
});

test("notifyRewardAmount is restricted to the reward distributor", () => {
  assert.match(source, /require\(msg\.sender == rewardDistributor, "Not reward distributor"\);/);
  assert.throws(
    () => notifyModel({ sender: "other", distributor: "owner", reward: 1n, duration: 1n }),
    /Not reward distributor/,
  );
});

test("scaled reward rate keeps precision error below 0.01 percent", () => {
  const reward = 1_000n * PRECISION;
  const duration = 3n;
  const rate = rewardRate({ reward, duration });
  const rpt = rewardPerToken({
    now: duration,
    periodFinish: duration,
    lastUpdateTime: 0n,
    rate,
    totalSupply: PRECISION,
  });
  const paid = earned({ balance: PRECISION, rpt });
  const error = reward - paid;

  assert.ok(error * 10_000n < reward);
});

test("token transfers require success", () => {
  assert.match(source, /require\(stakingToken\.transferFrom\(msg\.sender, address\(this\), amount\), "Stake transfer failed"\);/);
  assert.match(source, /require\(stakingToken\.transfer\(msg\.sender, amount\), "Stake transfer failed"\);/);
  assert.match(source, /require\(rewardToken\.transfer\(msg\.sender, reward\), "Reward transfer failed"\);/);
});
