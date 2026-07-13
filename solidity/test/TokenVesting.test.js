const assert = require("node:assert/strict");
const test = require("node:test");

const ONE_TOKEN = 10n ** 18n;
const MAX_ALLOCATION = 1_000_000_000n * ONE_TOKEN;
const START = 1_700_000_000n;
const CLIFF = 30n * 24n * 60n * 60n;
const DURATION = 365n * 24n * 60n * 60n;

function vestedAt(totalAllocation, start, cliffDuration, duration, timestamp) {
  const cliff = start + cliffDuration;
  if (timestamp < cliff) return 0n;

  const elapsed = timestamp - start;
  if (elapsed >= duration) return totalAllocation;

  const wholeUnitsPerSecond = totalAllocation / duration;
  const remainder = totalAllocation % duration;

  return wholeUnitsPerSecond * elapsed + (remainder * elapsed) / duration;
}

function revokeSplit(totalAllocation, claimed, vested) {
  const releasable = vested > claimed ? vested - claimed : 0n;
  return {
    beneficiary: releasable,
    owner: totalAllocation - claimed - releasable,
  };
}

test("vesting math handles maximum allocation without intermediate overflow", () => {
  const halfway = START + DURATION / 2n;
  const vested = vestedAt(MAX_ALLOCATION, START, CLIFF, DURATION, halfway);

  assert.equal(vested > 0n, true);
  assert.equal(vested < MAX_ALLOCATION, true);
});

test("full vesting completion releases the complete allocation", () => {
  const vested = vestedAt(MAX_ALLOCATION, START, CLIFF, DURATION, START + DURATION);

  assert.equal(vested, MAX_ALLOCATION);
});

test("remainder handling matches exact floor division through the schedule", () => {
  const awkwardAllocation = 1_000_000_000n * ONE_TOKEN + 7n;
  const timestamp = START + DURATION - 1n;
  const vested = vestedAt(awkwardAllocation, START, CLIFF, DURATION, timestamp);
  const ideal = (awkwardAllocation * (timestamp - START)) / DURATION;
  const completed = vestedAt(awkwardAllocation, START, CLIFF, DURATION, START + DURATION);

  assert.equal(vested, ideal);
  assert.equal(completed, awkwardAllocation);
});

test("cliff-period revocation returns all unclaimed tokens to owner", () => {
  const vested = vestedAt(MAX_ALLOCATION, START, CLIFF, DURATION, START + CLIFF - 1n);
  const split = revokeSplit(MAX_ALLOCATION, 0n, vested);

  assert.equal(split.beneficiary, 0n);
  assert.equal(split.owner, MAX_ALLOCATION);
});

test("post-cliff revocation releases vested-unclaimed and returns only unvested", () => {
  const vested = vestedAt(MAX_ALLOCATION, START, CLIFF, DURATION, START + DURATION / 3n);
  const claimed = vested / 4n;
  const split = revokeSplit(MAX_ALLOCATION, claimed, vested);

  assert.equal(split.beneficiary, vested - claimed);
  assert.equal(split.owner, MAX_ALLOCATION - vested);
  assert.equal(split.beneficiary + split.owner + claimed, MAX_ALLOCATION);
});
