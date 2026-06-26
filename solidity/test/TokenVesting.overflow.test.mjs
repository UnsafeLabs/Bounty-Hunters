import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../contracts/TokenVesting.sol", import.meta.url), "utf8");

function vestedModel({ totalAllocation, start = 0n, cliff, duration, now }) {
  if (now < cliff) return 0n;

  const elapsed = now - start;
  if (elapsed >= duration) return totalAllocation;

  const base = (totalAllocation / duration) * elapsed;
  const remainder = totalAllocation % duration;
  return base + (remainder * elapsed) / duration;
}

function revokeModel({ totalAllocation, vested, claimed }) {
  const claimableVested = vested > claimed ? vested - claimed : 0n;
  const unvested = totalAllocation - claimed - claimableVested;

  return {
    beneficiaryTransfer: claimableVested,
    ownerTransfer: unvested,
  };
}

test("vestedAmount uses overflow-safe quotient and remainder math", () => {
  assert.match(source, /import "@openzeppelin\/contracts\/utils\/math\/Math\.sol";/);
  assert.match(source, /totalAllocation \/ duration/);
  assert.match(source, /totalAllocation % duration/);
  assert.match(source, /Math\.mulDiv\(remainder, elapsed, duration\)/);
  assert.doesNotMatch(source, /totalAllocation\s*\*\s*elapsed\s*\/\s*duration/);
});

test("maximum allocation with long elapsed duration stays on the linear curve", () => {
  const totalAllocation = 1_000_000_000n * 10n ** 18n;
  const duration = 1_000_000_000_000n;
  const now = duration / 2n;

  assert.equal(
    vestedModel({ totalAllocation, cliff: 0n, duration, now }),
    totalAllocation / 2n,
  );
});

test("remainder handling is exact at intermediate timestamps", () => {
  const totalAllocation = 1_000_000_000_000_000_000_007n;
  const duration = 365n * 24n * 60n * 60n;

  for (const elapsed of [1n, 17n, 86_400n, duration / 3n, duration - 1n]) {
    assert.equal(
      vestedModel({ totalAllocation, cliff: 0n, duration, now: elapsed }),
      (totalAllocation * elapsed) / duration,
    );
  }
});

test("full vesting completion returns the entire allocation", () => {
  const totalAllocation = 123_456_789n;
  const duration = 10_000n;

  assert.equal(
    vestedModel({ totalAllocation, cliff: 0n, duration, now: duration }),
    totalAllocation,
  );
});

test("revocation during cliff returns all unclaimed tokens to owner", () => {
  assert.deepEqual(
    revokeModel({ totalAllocation: 1_000n, vested: 0n, claimed: 0n }),
    {
      beneficiaryTransfer: 0n,
      ownerTransfer: 1_000n,
    },
  );
});

test("revocation after partial vesting pays only unclaimed vested tokens to beneficiary", () => {
  assert.deepEqual(
    revokeModel({ totalAllocation: 1_000n, vested: 400n, claimed: 150n }),
    {
      beneficiaryTransfer: 250n,
      ownerTransfer: 600n,
    },
  );
});

test("claim and revoke paths require token transfer success", () => {
  assert.match(source, /require\(token\.transfer\(beneficiary, amount\), "Claim transfer failed"\);/);
  assert.match(source, /require\(token\.transfer\(beneficiary, claimableVested\), "Vested transfer failed"\);/);
  assert.match(source, /require\(token\.transfer\(owner, unvested\), "Unvested transfer failed"\);/);
});
