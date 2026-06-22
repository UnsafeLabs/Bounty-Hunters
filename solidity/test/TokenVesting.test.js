const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("TokenVesting", function () {
  async function deployFixture() {
    const [owner, beneficiary] = await ethers.getSigners();
    const ERC20 = await ethers.getContractFactory("MockERC20");
    const token = await ERC20.deploy("T", "T", ethers.parseEther("10000000"));
    const TokenVesting = await ethers.getContractFactory("TokenVesting");

    const alloc = ethers.parseEther("1000000");
    const now = Math.floor(Date.now() / 1000);
    const cliffDur = 1000;
    const vestDur = 10000;

    const vesting = await TokenVesting.deploy(
      await token.getAddress(), beneficiary.address, alloc, now, cliffDur, vestDur
    );
    await vesting.waitForDeployment();
    await token.transfer(await vesting.getAddress(), alloc);

    return { vesting, token, owner, beneficiary, alloc, cliffDur, vestDur, now };
  }

  describe("vestedAmount", function () {
    it("returns 0 before cliff", async function () {
      const { vesting } = await loadFixture(deployFixture);
      expect(await vesting.vestedAmount()).to.equal(0);
    });

    it("returns full allocation after full duration", async function () {
      const { vesting, alloc, cliffDur, vestDur } = await loadFixture(deployFixture);
      await ethers.provider.send("evm_increaseTime", [cliffDur + vestDur + 100]);
      await ethers.provider.send("evm_mine");
      expect(await vesting.vestedAmount()).to.equal(alloc);
    });

    it("vests approximately linearly", async function () {
      const { vesting, alloc, cliffDur, vestDur } = await loadFixture(deployFixture);
      // Jump to 5000s past start (= 50% through vesting, past cliff of 1000s)
      await ethers.provider.send("evm_increaseTime", [cliffDur + 4000]); // 1000+4000=5000
      await ethers.provider.send("evm_mine");
      const vested = await vesting.vestedAmount();
      const half = alloc / 2n;
      // Allow 1% tolerance for block timestamp drift
      const tolerance = alloc / 100n;
      expect(vested).to.be.closeTo(half, tolerance);
    });

    it("no overflow for 1B tokens", async function () {
      const { beneficiary, token } = await loadFixture(deployFixture);
      const TokenVesting = await ethers.getContractFactory("TokenVesting");
      const huge = ethers.parseEther("1000000000"); // 1 billion tokens
      const now = Math.floor(Date.now() / 1000);
      const hv = await TokenVesting.deploy(
        await token.getAddress(), beneficiary.address, huge, now, 0, 10000
      );
      await hv.waitForDeployment();

      // Jump to midpoint
      await ethers.provider.send("evm_increaseTime", [5000]);
      await ethers.provider.send("evm_mine");

      // Should not overflow — result should be between 0 and huge
      const v = await hv.vestedAmount();
      expect(v).to.be.gt(0);
      expect(v).to.be.lte(huge);
    });
  });

  describe("revoke", function () {
    it("sets revoked flag", async function () {
      const { vesting } = await loadFixture(deployFixture);
      await vesting.revoke();
      expect(await vesting.revoked()).to.equal(true);
    });

    it("sends vested tokens to beneficiary", async function () {
      const { vesting, token, owner, beneficiary, cliffDur, vestDur } = await loadFixture(deployFixture);
      await ethers.provider.send("evm_increaseTime", [cliffDur + vestDur / 2]);
      await ethers.provider.send("evm_mine");

      const vestedBefore = await vesting.vestedAmount();
      const benBefore = await token.balanceOf(beneficiary.address);

      await vesting.connect(owner).revoke();

      const benAfter = await token.balanceOf(beneficiary.address);
      // Should have received roughly the vested amount (may differ by 1 block + rounding)
      expect(benAfter - benBefore).to.be.closeTo(vestedBefore, ethers.parseEther("100"));
    });
  });

  describe("claim", function () {
    it("allows claiming after cliff", async function () {
      const { vesting, beneficiary, cliffDur } = await loadFixture(deployFixture);
      await ethers.provider.send("evm_increaseTime", [cliffDur + 1]);
      await ethers.provider.send("evm_mine");
      await vesting.connect(beneficiary).claim();
      expect(await vesting.claimed()).to.be.gt(0);
    });

    it("total claimed ≈ allocation at vesting end", async function () {
      const { vesting, beneficiary, alloc, cliffDur, vestDur } = await loadFixture(deployFixture);
      await ethers.provider.send("evm_increaseTime", [cliffDur + vestDur + 100]);
      await ethers.provider.send("evm_mine");
      await vesting.connect(beneficiary).claim();
      const claimed = await vesting.claimed();
      // Allow 1 token rounding error
      const diff = claimed > alloc ? claimed - alloc : alloc - claimed;
      expect(diff).to.be.lte(1);
    });

    it("rejects non-beneficiary", async function () {
      const { vesting, owner } = await loadFixture(deployFixture);
      await expect(vesting.connect(owner).claim()).to.be.revertedWith("Not beneficiary");
    });

    it("revocation after partial claim", async function () {
      const { vesting, owner, beneficiary, cliffDur, vestDur } = await loadFixture(deployFixture);
      await ethers.provider.send("evm_increaseTime", [cliffDur + vestDur / 4]);
      await ethers.provider.send("evm_mine");

      await vesting.connect(beneficiary).claim();
      expect(await vesting.claimed()).to.be.gt(0);

      await vesting.connect(owner).revoke();
      expect(await vesting.revoked()).to.equal(true);
    });
  });

  describe("edge cases", function () {
    it("prevents double revoke", async function () {
      const { vesting, owner } = await loadFixture(deployFixture);
      await vesting.connect(owner).revoke();
      await expect(vesting.connect(owner).revoke()).to.be.revertedWith("Already revoked");
    });

    it("accurate within 1 token for odd allocation/duration", async function () {
      const { token, beneficiary } = await loadFixture(deployFixture);
      const TokenVesting = await ethers.getContractFactory("TokenVesting");
      const oddAlloc = ethers.parseEther("1000001");
      const dur = 7777;
      const now = Math.floor(Date.now() / 1000);
      const v = await TokenVesting.deploy(await token.getAddress(), beneficiary.address, oddAlloc, now, 0, dur);
      await v.waitForDeployment();
      await token.transfer(await v.getAddress(), oddAlloc);
      await ethers.provider.send("evm_increaseTime", [dur + 1]);
      await ethers.provider.send("evm_mine");

      const vested = await v.vestedAmount();
      const diff = vested > oddAlloc ? vested - oddAlloc : oddAlloc - vested;
      expect(diff).to.be.lte(1);
    });
  });
});
