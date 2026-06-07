import assert from "node:assert/strict";

const UINT256_MAX = (1n << 256n) - 1n;
const DECIMALS = 10n ** 18n;
const MAX_ACCEPTED_ALLOCATION = 1_000_000_000n * DECIMALS;

function vulnerableVested(totalAllocation, elapsed, duration) {
  const product = totalAllocation * elapsed;
  if (product > UINT256_MAX) {
    throw new Error("uint256 multiplication overflow");
  }
  return product / duration;
}

function fixedVested(totalAllocation, elapsed, duration) {
  if (elapsed >= duration) return totalAllocation;
  const wholeTokenRate = totalAllocation / duration;
  const remainder = totalAllocation % duration;
  return wholeTokenRate * elapsed + (remainder * elapsed) / duration;
}

function revokeAccounting(totalAllocation, claimed, vested) {
  const payableVested = vested > claimed ? vested - claimed : 0n;
  const unvested = totalAllocation - claimed - payableVested;
  return { payableVested, unvested, newClaimed: claimed + payableVested };
}

function exactVested(totalAllocation, elapsed, duration) {
  return elapsed >= duration ? totalAllocation : (totalAllocation * elapsed) / duration;
}

{
  const duration = UINT256_MAX / MAX_ACCEPTED_ALLOCATION + 2n;
  const elapsed = duration - 1n;
  const allocation = MAX_ACCEPTED_ALLOCATION;

  assert.throws(() => vulnerableVested(allocation, elapsed, duration), /overflow/);
  assert.doesNotThrow(() => fixedVested(allocation, elapsed, duration));
  assert.equal(fixedVested(allocation, duration, duration), allocation);
}

{
  const allocation = 1_000_000n * DECIMALS + 123n;
  const duration = 365n * 24n * 60n * 60n;

  for (const elapsed of [1n, 97n, duration / 3n, duration / 2n, duration - 1n]) {
    const expected = exactVested(allocation, elapsed, duration);
    const actual = fixedVested(allocation, elapsed, duration);
    assert.ok(actual >= expected - 1n && actual <= expected + 1n);
  }

  assert.equal(fixedVested(allocation, duration, duration), allocation);
}

{
  const allocation = 5_000n * DECIMALS;
  const claimed = 0n;
  const vestedDuringCliff = 0n;
  const result = revokeAccounting(allocation, claimed, vestedDuringCliff);

  assert.equal(result.payableVested, 0n);
  assert.equal(result.unvested, allocation);
  assert.equal(result.newClaimed, 0n);
}

{
  const allocation = 9_000n * DECIMALS;
  const duration = 900n;
  const vested = fixedVested(allocation, 300n, duration);
  const claimed = 1_000n * DECIMALS;
  const result = revokeAccounting(allocation, claimed, vested);

  assert.equal(vested, 3_000n * DECIMALS);
  assert.equal(result.payableVested, 2_000n * DECIMALS);
  assert.equal(result.unvested, 6_000n * DECIMALS);
  assert.equal(result.newClaimed, 3_000n * DECIMALS);
}

{
  const allocation = 7n;
  const duration = 3n;

  assert.equal(fixedVested(allocation, 1n, duration), 2n);
  assert.equal(fixedVested(allocation, 2n, duration), 4n);
  assert.equal(fixedVested(allocation, 3n, duration), 7n);
}

console.log("TokenVesting overflow and revoke checks passed");
