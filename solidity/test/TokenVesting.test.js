const assert = require('assert');

function vestedAmount(totalAllocation, start, cliff, duration, timestamp) {
  if (timestamp < cliff) return 0n;

  const elapsed = timestamp - start;
  if (elapsed >= duration) return totalAllocation;

  const baseVested = (totalAllocation / duration) * elapsed;
  const remainderVested = ((totalAllocation % duration) * elapsed) / duration;
  return baseVested + remainderVested;
}

function revokeAmounts(totalAllocation, vested, claimed) {
  const claimableVested = vested > claimed ? vested - claimed : 0n;
  return {
    beneficiary: claimableVested,
    owner: totalAllocation - claimed - claimableVested,
  };
}

describe('TokenVesting arithmetic', function () {
  const start = 1_700_000_000n;
  const duration = 4n * 365n * 24n * 60n * 60n;
  const cliff = start + 90n * 24n * 60n * 60n;

  it('handles the maximum requested allocation without overflow-prone multiplication', function () {
    const total = 1_000_000_000n * 10n ** 18n;
    const halfway = start + duration / 2n;

    assert.strictEqual(vestedAmount(total, start, cliff, duration, halfway), total / 2n);
  });

  it('keeps the vesting remainder and releases the full allocation at completion', function () {
    const total = 100n;
    const shortDuration = 6n;

    assert.strictEqual(vestedAmount(total, start, start, shortDuration, start + 3n), 50n);
    assert.strictEqual(vestedAmount(total, start, start, shortDuration, start + shortDuration), total);
  });

  it('is within one token unit of the exact linear curve before completion', function () {
    const total = 1_000_000_000n * 10n ** 18n + 17n;
    const elapsed = 12_345_678n;
    const actual = vestedAmount(total, start, start, duration, start + elapsed);
    const exactFloor = total * elapsed / duration;

    assert(actual <= exactFloor + 1n);
    assert(actual + 1n >= exactFloor);
  });

  it('returns unclaimed allocation to the owner when revoked during the cliff', function () {
    const total = 1_000n;
    const vested = vestedAmount(total, start, cliff, duration, start + 1n);
    const amounts = revokeAmounts(total, vested, 0n);

    assert.strictEqual(amounts.beneficiary, 0n);
    assert.strictEqual(amounts.owner, total);
  });

  it('returns only truly unvested tokens after partial vesting', function () {
    const total = 1_000n;
    const vested = 400n;
    const claimed = 125n;
    const amounts = revokeAmounts(total, vested, claimed);

    assert.strictEqual(amounts.beneficiary, 275n);
    assert.strictEqual(amounts.owner, 600n);
  });
});
