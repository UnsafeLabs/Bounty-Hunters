const assert = require("node:assert/strict");
const { ethers, network } = require("hardhat");

const MAX_UINT256 = (1n << 256n) - 1n;

describe("TokenVesting", function () {
  async function deployToken(initialSupply) {
    const Token = await ethers.getContractFactory("GovernanceToken");
    return Token.deploy(initialSupply);
  }

  async function deployVesting({
    allocation,
    start,
    cliffDuration = 0n,
    duration,
    harness = false
  }) {
    const [owner, beneficiary] = await ethers.getSigners();
    const token = await deployToken(allocation);
    const Vesting = await ethers.getContractFactory(harness ? "TokenVestingHarness" : "TokenVesting");
    const vesting = await Vesting.deploy(
      await token.getAddress(),
      beneficiary.address,
      allocation,
      start,
      cliffDuration,
      duration
    );
    return { owner, beneficiary, token, vesting };
  }

  async function latestTimestamp() {
    const block = await ethers.provider.getBlock("latest");
    return BigInt(block.timestamp);
  }

  async function setNextBlockTimestamp(timestamp) {
    await network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  }

  it("does not overflow when the equivalent totalAllocation * elapsed product exceeds uint256", async function () {
    const allocation = 1_000_000_000n * 10n ** 18n;
    const duration = MAX_UINT256;
    const elapsed = MAX_UINT256 / allocation + 1n;
    assert(allocation * elapsed > MAX_UINT256);

    const { vesting } = await deployVesting({
      allocation,
      start: 0n,
      duration,
      harness: true
    });

    const expected = allocation * elapsed / duration;
    assert.equal(await vesting.vestedAmountAt(elapsed), expected);
  });

  it("keeps the linear vesting curve within one token unit while preserving remainders", async function () {
    const allocation = 1_000_000_000n * 10n ** 18n + 123n;
    const duration = 997n;
    const { vesting } = await deployVesting({
      allocation,
      start: 0n,
      duration,
      harness: true
    });

    for (let elapsed = 0n; elapsed < duration; elapsed += 37n) {
      const expected = allocation * elapsed / duration;
      const actual = await vesting.vestedAmountAt(elapsed);
      const delta = actual > expected ? actual - expected : expected - actual;
      assert(delta <= 1n, `elapsed ${elapsed}: expected ${expected}, got ${actual}`);
    }

    assert.equal(await vesting.vestedAmountAt(duration), allocation);
  });

  it("allows the beneficiary to claim the full allocation at vesting completion", async function () {
    const allocation = 1_000_000_000n * 10n ** 18n + 1n;
    const duration = 365n * 24n * 60n * 60n;
    const start = await latestTimestamp() + 100n;
    const { beneficiary, token, vesting } = await deployVesting({ allocation, start, duration });
    const vestingAddress = await vesting.getAddress();
    await token.transfer(vestingAddress, allocation);

    await setNextBlockTimestamp(start + duration);
    await vesting.connect(beneficiary).claim();

    assert.equal(await token.balanceOf(beneficiary.address), allocation);
    assert.equal(await vesting.claimed(), allocation);
    assert.equal(await vesting.claimable(), 0n);
  });

  it("returns the whole unclaimed allocation to the owner when revoked during the cliff", async function () {
    const allocation = 1_000_000n;
    const duration = 1_000n;
    const cliffDuration = 200n;
    const start = await latestTimestamp() + 100n;
    const { owner, beneficiary, token, vesting } = await deployVesting({
      allocation,
      start,
      cliffDuration,
      duration
    });
    const vestingAddress = await vesting.getAddress();
    await token.transfer(vestingAddress, allocation);
    const ownerBalanceBefore = await token.balanceOf(owner.address);

    await vesting.revoke();

    assert.equal(await token.balanceOf(vestingAddress), 0n);
    assert.equal(await token.balanceOf(beneficiary.address), 0n);
    assert.equal(await token.balanceOf(owner.address), ownerBalanceBefore + allocation);
  });

  it("returns only truly unvested tokens after partial vesting and prior claims", async function () {
    const allocation = 1_000n;
    const duration = 1_000n;
    const start = await latestTimestamp() + 100n;
    const { owner, beneficiary, token, vesting } = await deployVesting({ allocation, start, duration });
    const vestingAddress = await vesting.getAddress();
    await token.transfer(vestingAddress, allocation);
    const ownerBalanceBefore = await token.balanceOf(owner.address);

    await setNextBlockTimestamp(start + 250n);
    await vesting.connect(beneficiary).claim();
    assert.equal(await token.balanceOf(beneficiary.address), 250n);

    await setNextBlockTimestamp(start + 400n);
    await vesting.revoke();

    assert.equal(await token.balanceOf(beneficiary.address), 400n);
    assert.equal(await token.balanceOf(owner.address), ownerBalanceBefore + 600n);
    assert.equal(await token.balanceOf(vestingAddress), 0n);
  });
});
