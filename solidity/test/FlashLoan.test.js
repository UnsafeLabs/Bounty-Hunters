const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

describe("FlashLoan", function () {
  async function deploy({ rebasing = false } = {}) {
    const [owner, depositor, stranger] = await ethers.getSigners();
    const Token = await ethers.getContractFactory(rebasing ? "RebasingTestToken" : "TestToken");
    const token = await Token.deploy(1_000_000n);

    const FlashLoan = await ethers.getContractFactory("FlashLoan");
    const lender = await FlashLoan.deploy(await token.getAddress(), 100n);
    const lenderAddress = await lender.getAddress();

    await token.transfer(depositor.address, 200_000n);
    await token.connect(depositor).approve(lenderAddress, 200_000n);
    await lender.connect(depositor).depositToPool(100_000n);

    const Receiver = await ethers.getContractFactory("FlashLoanReceiver");
    const receiver = await Receiver.deploy(await token.getAddress(), lenderAddress);
    await token.mint(await receiver.getAddress(), 10_000n);

    return { owner, depositor, stranger, token, lender, lenderAddress, receiver };
  }

  it("charges a minimum fee of one token unit for small flash loans", async function () {
    const { receiver, lender } = await deploy();

    await receiver.borrow(1n);

    assert.equal(await receiver.lastFee(), 1n);
    assert.equal(await lender.totalFees(), 1n);
    assert.equal(await lender.getPoolBalance(), 100_000n);
  });

  it("rejects loans that exceed half of the internally accounted pool", async function () {
    const { receiver, lender } = await deploy();

    assert.equal(await lender.maxLoanAmount(), 50_000n);
    await assert.rejects(receiver.borrow(50_001n), /Loan exceeds max amount/);
  });

  it("uses internal accounting so direct token donations do not raise the loan cap", async function () {
    const { owner, token, lender, lenderAddress, receiver } = await deploy();

    await token.connect(owner).transfer(lenderAddress, 800_000n);

    assert.equal(await token.balanceOf(lenderAddress), 900_000n);
    assert.equal(await lender.getPoolBalance(), 100_000n);
    assert.equal(await lender.maxLoanAmount(), 50_000n);
    await assert.rejects(receiver.borrow(500_000n), /Insufficient pool balance/);
  });

  it("rejects repayment when a rebasing token reduces the lender balance during callback", async function () {
    const { receiver } = await deploy({ rebasing: true });

    await receiver.setMode(1, 1n);

    await assert.rejects(receiver.borrow(1_000n), /Loan not repaid/);
  });

  it("pauses and unpauses flash loans through the owner", async function () {
    const { stranger, receiver, lender } = await deploy();

    await assert.rejects(lender.connect(stranger).pause(), /Not owner/);

    await lender.pause();
    assert.equal(await lender.paused(), true);
    await assert.rejects(receiver.borrow(1n), /Paused/);

    await lender.unpause();
    assert.equal(await lender.paused(), false);
    await receiver.borrow(1n);
  });

  it("tracks and withdraws fees without reducing accounted pool principal", async function () {
    const { owner, token, lender, receiver } = await deploy();
    const ownerBalanceBefore = await token.balanceOf(owner.address);

    await receiver.borrow(10_000n);

    assert.equal(await lender.totalFees(), 100n);
    assert.equal(await lender.getPoolBalance(), 100_000n);

    await lender.withdrawFees();

    assert.equal(await lender.totalFees(), 0n);
    assert.equal(await lender.getPoolBalance(), 100_000n);
    assert.equal(await token.balanceOf(owner.address), ownerBalanceBefore + 100n);
  });
});
