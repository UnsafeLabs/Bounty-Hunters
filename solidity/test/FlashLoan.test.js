const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashLoan", function () {
  async function deployFixture() {
    const [owner, borrower] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockToken");
    const token = await Token.deploy("Loan Token", "LOAN");
    const FlashLoan = await ethers.getContractFactory("FlashLoan");
    const flashLoan = await FlashLoan.deploy(await token.getAddress(), 100);
    const Borrower = await ethers.getContractFactory("FlashLoanBorrower");
    const receiver = await Borrower.connect(borrower).deploy(
      await flashLoan.getAddress(),
      await token.getAddress()
    );

    await token.mint(owner.address, 1000000);
    await token.approve(await flashLoan.getAddress(), 1000000);
    await flashLoan.depositToPool(100000);

    return { owner, borrower, token, flashLoan, receiver };
  }

  it("charges a minimum fee for small loans", async function () {
    const { flashLoan, token, receiver } = await deployFixture();

    await token.mint(await receiver.getAddress(), 1);
    await expect(flashLoan.flashLoan(1, "0x", await receiver.getAddress()))
      .to.emit(flashLoan, "FlashLoanExecuted")
      .withArgs(await receiver.getAddress(), 1, 1);
    expect(await flashLoan.totalFees()).to.equal(1);
  });

  it("rejects loans above fifty percent of pool balance", async function () {
    const { flashLoan, receiver } = await deployFixture();

    await expect(
      flashLoan.flashLoan(50001, "0x", await receiver.getAddress())
    ).to.be.revertedWith("Amount exceeds loan cap");
  });

  it("rejects unaccounted balance changes before lending", async function () {
    const { flashLoan, token, receiver } = await deployFixture();

    await token.mint(await flashLoan.getAddress(), 1);
    await expect(
      flashLoan.flashLoan(1000, "0x", await receiver.getAddress())
    ).to.be.revertedWith("Unaccounted token balance");
  });

  it("pauses and unpauses flash loans", async function () {
    const { flashLoan, receiver } = await deployFixture();

    await flashLoan.pause();
    await expect(
      flashLoan.flashLoan(1000, "0x", await receiver.getAddress())
    ).to.be.revertedWith("Paused");

    await flashLoan.unpause();
    expect(await flashLoan.paused()).to.equal(false);
  });
});
