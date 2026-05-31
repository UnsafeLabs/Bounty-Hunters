const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenVesting", function () {
  let token;
  let vesting;
  let owner, beneficiary;
  const ONE_DAY = 86400;
  const ONE_YEAR = 365 * ONE_DAY;
  const MAX_UINT256 = ethers.MaxUint256;

  beforeEach(async function () {
    [owner, beneficiary] = await ethers.getSigners();

    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    token = await ERC20Mock.deploy("Test", "TST", owner.address, ethers.parseUnits("1000000000", 18));
    await token.waitForDeployment();
  });

  async function deployVesting(allocation, vestingDuration, cliffDuration, startTime) {
    const start = startTime ?? (await ethers.provider.getBlock("latest")).timestamp + 100;
    const cliff = cliffDuration ?? ONE_YEAR;
    const duration = vestingDuration ?? 4 * ONE_YEAR;

    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    vesting = await TokenVesting.deploy(
      await token.getAddress(),
      beneficiary.address,
      allocation,
      start,
      cliff,
      duration
    );
    await vesting.waitForDeployment();

    await token.transfer(await vesting.getAddress(), allocation);

    return { start, cliff: start + cliff, duration };
  }

  describe("constructor overflow guard", function () {
    it("should reject allocation that would overflow during vesting", async function () {
      const duration = 100;
      const maxSafe = MAX_UINT256 / BigInt(duration);
      const unsafeAllocation = maxSafe + 1n;

      const start = (await ethers.provider.getBlock("latest")).timestamp + 100;
      const TokenVesting = await ethers.getContractFactory("TokenVesting");

      await expect(
        TokenVesting.deploy(
          await token.getAddress(),
          beneficiary.address,
          unsafeAllocation,
          start,
          50,
          duration
        )
      ).to.be.revertedWithCustomError(TokenVesting, "AllocationTooLarge");
    });

    it("should accept allocation at the safe boundary", async function () {
      const duration = 100;
      const maxSafe = MAX_UINT256 / BigInt(duration);

      await deployVesting(maxSafe, duration, 50);
      expect(await vesting.totalAllocation()).to.equal(maxSafe);
    });

    it("should reject zero duration", async function () {
      const TokenVesting = await ethers.getContractFactory("TokenVesting");
      const start = (await ethers.provider.getBlock("latest")).timestamp + 100;

      await expect(
        TokenVesting.deploy(
          await token.getAddress(),
          beneficiary.address,
          ethers.parseUnits("1000", 18),
          start,
          0,
          0
        )
      ).to.be.revertedWith("Duration must be > 0");
    });

    it("should reject cliff exceeding duration", async function () {
      const TokenVesting = await ethers.getContractFactory("TokenVesting");
      const start = (await ethers.provider.getBlock("latest")).timestamp + 100;

      await expect(
        TokenVesting.deploy(
          await token.getAddress(),
          beneficiary.address,
          ethers.parseUnits("1000", 18),
          start,
          ONE_YEAR * 5,
          ONE_YEAR * 4
        )
      ).to.be.revertedWith("Cliff exceeds duration");
    });
  });

  describe("vestedAmount with large allocations", function () {
    it("should correctly compute vested amount for large safe allocations", async function () {
      const duration = 4 * ONE_YEAR;
      const largeAllocation = ethers.parseUnits("1000000000", 18);

      const { start: startTime } = await deployVesting(largeAllocation, duration, ONE_YEAR);

      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + ONE_YEAR + ONE_YEAR]);
      await ethers.provider.send("evm_mine");

      const vested = await vesting.vestedAmount();
      const expected = (largeAllocation * BigInt(2 * ONE_YEAR)) / BigInt(duration);
      expect(vested).to.equal(expected);
    });

    it("should return 0 during cliff period", async function () {
      const allocation = ethers.parseUnits("1000", 18);
      await deployVesting(allocation, 4 * ONE_YEAR, ONE_YEAR);

      expect(await vesting.vestedAmount()).to.equal(0);
    });

    it("should return totalAllocation after full duration", async function () {
      const allocation = ethers.parseUnits("1000", 18);
      const { start: startTime, duration: dur } = await deployVesting(allocation, 4 * ONE_YEAR, ONE_YEAR);

      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + dur + 1]);
      await ethers.provider.send("evm_mine");

      expect(await vesting.vestedAmount()).to.equal(allocation);
    });
  });

  describe("claim", function () {
    it("should allow beneficiary to claim vested tokens", async function () {
      const allocation = ethers.parseUnits("1000", 18);
      const { start: startTime, duration: dur } = await deployVesting(allocation, 4 * ONE_YEAR, ONE_YEAR);

      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + dur]);
      await ethers.provider.send("evm_mine");

      await expect(vesting.connect(beneficiary).claim())
        .to.emit(vesting, "TokensClaimed")
        .withArgs(beneficiary.address, allocation);
    });

    it("should reject non-beneficiary claiming", async function () {
      await deployVesting(ethers.parseUnits("1000", 18), 4 * ONE_YEAR, ONE_YEAR);
      await expect(vesting.connect(owner).claim()).to.be.revertedWith("Not beneficiary");
    });
  });

  describe("revoke", function () {
    it("should transfer unvested tokens to owner", async function () {
      const allocation = ethers.parseUnits("1000", 18);
      const { start: startTime, duration: dur } = await deployVesting(allocation, 4 * ONE_YEAR, ONE_YEAR);

      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + ONE_YEAR + ONE_YEAR]);
      await ethers.provider.send("evm_mine");

      const vested = await vesting.vestedAmount();
      const expectedUnvested = allocation - vested;

      await expect(vesting.revoke()).to.emit(vesting, "VestingRevoked").withArgs(beneficiary.address, expectedUnvested);
    });

    it("should reject double revoke", async function () {
      await deployVesting(ethers.parseUnits("1000", 18), 4 * ONE_YEAR, ONE_YEAR);
      await vesting.revoke();
      await expect(vesting.revoke()).to.be.revertedWith("Already revoked");
    });

    it("should reject non-owner revoke", async function () {
      await deployVesting(ethers.parseUnits("1000", 18), 4 * ONE_YEAR, ONE_YEAR);
      await expect(vesting.connect(beneficiary).revoke()).to.be.revertedWith("Not owner");
    });
  });
});
