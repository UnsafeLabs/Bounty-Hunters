const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashLoan", function () {
  let loan, token, owner, borrower;
  const FEE_BPS = 50; // 0.5%

  beforeEach(async function () {
    [owner, borrower] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("GovernanceToken");
    token = await Token.deploy(ethers.parseEther("10000"));
    await token.waitForDeployment();

    const FlashLoan = await ethers.getContractFactory("FlashLoan");
    loan = await FlashLoan.deploy(await token.getAddress(), FEE_BPS);
    await loan.waitForDeployment();

    // Fund the pool via deposit
    await token.approve(await loan.getAddress(), ethers.parseEther("5000"));
    await loan.depositToPool(ethers.parseEther("5000"));
  });

  describe("Pool management", function () {
    it("should accept deposits and track balance", async function () {
      const bal = await loan.getPoolBalance();
      expect(bal).to.equal(ethers.parseEther("5000"));
    });
  });

  describe("Max loan amount", function () {
    it("should cap max loan at 50% of pool", async function () {
      const maxLoan = await loan.maxLoanAmount();
      const poolBal = await loan.getPoolBalance();
      expect(maxLoan).to.equal(poolBal / 2n);
    });

    it("should reject loan exceeding max", async function () {
      const maxLoan = await loan.maxLoanAmount();
      await expect(
        loan.flashLoan(maxLoan + 1n, "0x")
      ).to.be.revertedWith("Exceeds max loan amount");
    });
  });

  describe("Emergency pause", function () {
    it("should disable flash loans when paused", async function () {
      await loan.pause();
      await expect(
        loan.flashLoan(100, "0x")
      ).to.be.revertedWith("Paused");
    });

    it("should re-enable flash loans when unpaused", async function () {
      await loan.pause();
      await loan.unpause();
      expect(await loan.paused()).to.equal(false);
    });

    it("should only allow owner to pause", async function () {
      await expect(
        loan.connect(borrower).pause()
      ).to.be.revertedWith("Not owner");
    });

    it("should only allow owner to unpause", async function () {
      await loan.pause();
      await expect(
        loan.connect(borrower).unpause()
      ).to.be.revertedWith("Not owner");
    });
  });

  describe("Fee tracking", function () {
    it("should start with zero fees", async function () {
      expect(await loan.totalFees()).to.equal(0);
    });

    it("should allow owner to withdraw fees", async function () {
      const balBefore = await token.balanceOf(owner.address);
      await loan.withdrawFees();
      const balAfter = await token.balanceOf(owner.address);
      expect(balAfter - balBefore).to.equal(0); // No fees accumulated yet
    });
  });

  describe("Internal accounting", function () {
    it("should track pool balance independently of token balance", async function () {
      // Donate tokens directly to contract
      await token.transfer(await loan.getAddress(), ethers.parseEther("100"));
      // Pool balance should NOT include donation
      expect(await loan.getPoolBalance()).to.equal(ethers.parseEther("5000"));
      // After sync, it should include donation
      await loan.syncBalance();
      expect(await loan.getPoolBalance()).to.equal(ethers.parseEther("5100"));
    });
  });
});
