import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../contracts/TokenVesting.sol", import.meta.url), "utf8");

class TokenVestingModel {
  constructor({ totalAllocation, start, cliffDuration, duration }) {
    assert(BigInt(duration) > 0n, "Invalid duration");
    assert(BigInt(cliffDuration) <= BigInt(duration), "Invalid cliff");
    this.totalAllocation = BigInt(totalAllocation);
    this.start = BigInt(start);
    this.cliff = this.start + BigInt(cliffDuration);
    this.duration = BigInt(duration);
    this.claimed = 0n;
    this.revoked = false;
  }

  vestedAmount(now) {
    now = BigInt(now);
    if (now < this.cliff) return 0n;

    const elapsed = now - this.start;
    if (elapsed >= this.duration) return this.totalAllocation;

    const vestedWhole = (this.totalAllocation / this.duration) * elapsed;
    const remainder = this.totalAllocation % this.duration;
    const vestedRemainder = (remainder * elapsed) / this.duration;
    return vestedWhole + vestedRemainder;
  }

  claimable(now) {
    if (this.revoked) return 0n;
    const vested = this.vestedAmount(now);
    return vested > this.claimed ? vested - this.claimed : 0n;
  }

  claim(now) {
    const amount = this.claimable(now);
    assert(amount > 0n, "Nothing to claim");
    this.claimed += amount;
    return amount;
  }

  revoke(now) {
    assert.equal(this.revoked, false, "Already revoked");
    const vested = this.vestedAmount(now);
    const claimableOnRevoke = vested > this.claimed ? vested - this.claimed : 0n;
    const unvested = this.totalAllocation - this.claimed - claimableOnRevoke;
    this.revoked = true;
    this.claimed += claimableOnRevoke;
    return { claimableOnRevoke, unvested };
  }
}

test("source avoids overflow-prone totalAllocation times elapsed math", () => {
  assert.match(source, /totalAllocation \/ duration \* elapsed/);
  assert.match(source, /totalAllocation % duration/);
  assert.doesNotMatch(source, /totalAllocation \* elapsed \/ duration/);
  assert.doesNotMatch(source, /block\.timestamp >= start \+ duration/);
});

test("maximum supported allocation vests without intermediate overflow", () => {
  const totalAllocation = 1_000_000_000n * 10n ** 18n;
  const vesting = new TokenVestingModel({
    totalAllocation,
    start: 1_000n,
    cliffDuration: 0n,
    duration: 4n * 365n * 24n * 60n * 60n,
  });

  assert.equal(vesting.vestedAmount(1_000n), 0n);
  assert(vesting.vestedAmount(1_000n + 60n * 60n) > 0n);
  assert.equal(vesting.vestedAmount(1_000n + vesting.duration), totalAllocation);
});

test("remainder handling reaches the exact total allocation at vesting end", () => {
  const vesting = new TokenVestingModel({
    totalAllocation: 10n,
    start: 0n,
    cliffDuration: 0n,
    duration: 3n,
  });

  assert.equal(vesting.vestedAmount(1n), 3n);
  assert.equal(vesting.vestedAmount(2n), 6n);
  assert.equal(vesting.vestedAmount(3n), 10n);
});

test("linear vesting stays within one token unit of ideal pro rata amount", () => {
  const vesting = new TokenVestingModel({
    totalAllocation: 1_000n,
    start: 100n,
    cliffDuration: 0n,
    duration: 333n,
  });

  for (const elapsed of [1n, 2n, 17n, 101n, 222n, 332n]) {
    const now = 100n + elapsed;
    const actual = vesting.vestedAmount(now);
    const idealFloor = (1_000n * elapsed) / 333n;
    assert(actual >= idealFloor);
    assert(actual <= idealFloor + 1n);
  }
});

test("revocation during cliff returns total unclaimed allocation to owner", () => {
  const vesting = new TokenVestingModel({
    totalAllocation: 1_000n,
    start: 100n,
    cliffDuration: 50n,
    duration: 500n,
  });

  assert.deepEqual(vesting.revoke(120n), {
    claimableOnRevoke: 0n,
    unvested: 1_000n,
  });
  assert.equal(vesting.claimed, 0n);
  assert.equal(vesting.claimable(200n), 0n);
});

test("post-cliff revocation pays only unclaimed vested tokens to beneficiary", () => {
  const vesting = new TokenVestingModel({
    totalAllocation: 1_000n,
    start: 0n,
    cliffDuration: 0n,
    duration: 100n,
  });

  assert.equal(vesting.claim(25n), 250n);
  assert.deepEqual(vesting.revoke(40n), {
    claimableOnRevoke: 150n,
    unvested: 600n,
  });
  assert.equal(vesting.claimed, 400n);
  assert.equal(vesting.claimable(100n), 0n);
});

test("source requires successful token transfers and blocks claims after revocation", () => {
  assert.match(source, /require\(!revoked, "Vesting revoked"\)/);
  assert.match(source, /require\(token\.transfer\(beneficiary, amount\), "Transfer failed"\)/);
  assert.match(
    source,
    /require\(token\.transfer\(owner, unvested\), "Owner transfer failed"\)/
  );
});
