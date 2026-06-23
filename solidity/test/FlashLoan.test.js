const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashLoan", function () {
  let flashLoan;
  let token;
  let owner;
  let user;
  let receiver;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("GovernanceToken");
    token = await Token.deploy(ethers.parseEther("1000000"));

    const FlashLoan = await ethers.getContractFactory("FlashLoan");
    flashLoan = await FlashLoan.deploy(token.target, 50); // 0.5% fee

    const Receiver = await ethers.getContractFactory("FlashLoanReceiverMock");
    receiver = await Receiver.deploy();

    // Correctly deposit funds only via depositToPool
    await token.approve(flashLoan.target, ethers.parseEther("10000"));
    await flashLoan.depositToPool(ethers.parseEther("10000"));

    // Fund receiver with some tokens for fees
    await token.transfer(receiver.target, ethers.parseEther("1000"));
  });

  it("Should execute flash loan correctly and repay with fee", async function () {
    const loanAmount = ethers.parseEther("100");
    const expectedFee = ethers.parseEther("0.5"); // 0.5% of 100

    const initialReserve = await flashLoan.getPoolBalance();

    await receiver.executeLoan(flashLoan.target, loanAmount);

    expect(await flashLoan.getPoolBalance()).to.equal(initialReserve + expectedFee);
  });

  it("Should enforce a minimum fee of 1 wei when amount is very small", async function () {
    const loanAmount = 1; // 1 wei
    const expectedFee = 1; // minimum fee of 1

    const initialReserve = await flashLoan.getPoolBalance();

    await receiver.executeLoan(flashLoan.target, loanAmount);

    expect(await flashLoan.getPoolBalance()).to.equal(initialReserve + ethers.toBigInt(expectedFee));
  });

  it("Should fail if repayment is not made", async function () {
    const loanAmount = ethers.parseEther("100");
    await receiver.setFailRepayment(true);

    await expect(
      receiver.executeLoan(flashLoan.target, loanAmount)
    ).to.be.revertedWith("Loan not repaid");
  });
});
