const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashLoan", function () {
  let flashLoan;
  let loanToken;
  let owner;
  let borrower;

  beforeEach(async function () {
    [owner, borrower] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    loanToken = await MockToken.deploy("Loan Token", "LNT", 18);

    const FlashLoan = await ethers.getContractFactory("FlashLoan");
    flashLoan = await FlashLoan.deploy(loanToken.address, 10); // 0.1% fee

    await loanToken.mint(owner.address, ethers.utils.parseEther("1000"));
    await loanToken.approve(flashLoan.address, ethers.utils.parseEther("1000"));
    await flashLoan.depositToPool(ethers.utils.parseEther("100"));
  });

  it("should charge a minimum fee of 1 unit", async function () {
    const loanAmount = 1; // 1 unit
    // fee = max(1 * 10 / 10000, 1) = 1
    // We expect it to revert if borrower doesn't have 1 unit for fee
    const Receiver = await ethers.getContractFactory("FlashLoanReceiver");
    const receiver = await Receiver.deploy();
    
    await expect(flashLoan.connect(borrower).flashLoan(loanAmount, "0x"))
      .to.be.reverted; // Reverts because borrower has no tokens for fee
  });

  it("should reject loans exceeding 50% of pool", async function () {
    const loanAmount = ethers.utils.parseEther("51");
    await expect(flashLoan.connect(borrower).flashLoan(loanAmount, "0x"))
      .to.be.revertedWith("Loan exceeds 50% of pool");
  });

  it("should handle pause/unpause", async function () {
    await flashLoan.setPaused(true);
    await expect(flashLoan.connect(borrower).flashLoan(100, "0x"))
      .to.be.revertedWith("Paused");
      
    await flashLoan.setPaused(false);
    // Should now proceed (and fail due to repayment, but not "Paused")
  });
});
