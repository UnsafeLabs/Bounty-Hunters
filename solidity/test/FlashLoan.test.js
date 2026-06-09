const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashLoan", function () {
  let token;
  let pool;
  let receiver;
  let owner;
  let user;
  let attacker;

  beforeEach(async function () {
    [owner, user, attacker] = await ethers.getSigners();

    // Deploy Mock Token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("Loan Token", "LTK");
    await token.waitForDeployment();

    const tokenAddress = token.target || token.address;

    // Deploy FlashLoan with 50 basis points fee (0.5%)
    const FlashLoan = await ethers.getContractFactory("FlashLoan");
    pool = await FlashLoan.deploy(tokenAddress, 50);
    await pool.waitForDeployment();

    const poolAddress = pool.target || pool.address;

    // Deploy MockFlashLoanReceiver
    const MockReceiver = await ethers.getContractFactory("MockFlashLoanReceiver");
    receiver = await MockReceiver.deploy();
    await receiver.waitForDeployment();

    const receiverAddress = receiver.target || receiver.address;

    // Send tokens to receiver for fees
    await token.mint(receiverAddress, ethers.parseEther("100"));

    // Set up pool liquidity: 10,000 tokens
    await token.mint(owner.address, ethers.parseEther("10000"));
    await token.approve(poolAddress, ethers.MaxUint256);
    await pool.depositToPool(ethers.parseEther("10000"));
  });

  it("should enforce minimum fee of 1 token unit for small loans", async function () {
    const poolAddress = pool.target || pool.address;
    const receiverAddress = receiver.target || receiver.address;

    // Small loan: 10 wei
    // 10 * 50 / 10000 = 0 (truncates to 0). So fee should be 1.
    const amount = 10n;
    const fee = 1n;

    // Approve the receiver to spend token (so it can transfer amount + fee back to pool)
    await token.connect(user).approve(poolAddress, ethers.MaxUint256);

    // Run flash loan
    await expect(receiver.executeFlashLoan(poolAddress, amount))
      .to.emit(pool, "FlashLoanExecuted")
      .withArgs(receiverAddress, amount, fee);
  });

  it("should reject loans exceeding 50% of the poolBalance", async function () {
    const poolAddress = pool.target || pool.address;
    
    // Pool has 10,000 tokens (10,000 * 10^18)
    const maxLoan = ethers.parseEther("5000");
    const excessiveLoan = maxLoan + 1n;

    // Try excessive loan
    await expect(
      receiver.executeFlashLoan(poolAddress, excessiveLoan)
    ).to.be.revertedWith("Loan exceeds 50% of pool balance");

    // Max loan should succeed
    await expect(
      receiver.executeFlashLoan(poolAddress, maxLoan)
    ).to.not.be.reverted;
  });

  it("should prevent donation attacks from inflating the borrow limit", async function () {
    const poolAddress = pool.target || pool.address;

    // Pool balance is 10,000 tokens. Max loan is 5,000 tokens.
    // Attacker donates 10,000 tokens directly to the pool contract
    await token.mint(poolAddress, ethers.parseEther("10000"));

    // Actual token balance is 20,000 tokens.
    // But poolBalance should still be 10,000 tokens.
    // So borrowing 6,000 tokens should still be rejected!
    await expect(
      receiver.executeFlashLoan(poolAddress, ethers.parseEther("6000"))
    ).to.be.revertedWith("Loan exceeds 50% of pool balance");
  });

  it("should emergency pause and unpause flash loan execution", async function () {
    const poolAddress = pool.target || pool.address;

    // Pause flash loans
    await pool.pause();
    expect(await pool.paused()).to.be.true;

    // Flash loan should fail
    await expect(
      receiver.executeFlashLoan(poolAddress, ethers.parseEther("1000"))
    ).to.be.revertedWith("Paused");

    // Unpause
    await pool.unpause();
    expect(await pool.paused()).to.be.false;

    // Flash loan should succeed
    await expect(
      receiver.executeFlashLoan(poolAddress, ethers.parseEther("1000"))
    ).to.not.be.reverted;
  });

  it("should track fee accrual and poolBalance correctly", async function () {
    const poolAddress = pool.target || pool.address;

    const initialFees = await pool.totalFees();
    const initialPoolBalance = await pool.getPoolBalance();

    const loanAmount = ethers.parseEther("2000"); // fee = 2000 * 50 / 10000 = 10 tokens
    const expectedFee = ethers.parseEther("10");

    await receiver.executeFlashLoan(poolAddress, loanAmount);

    expect(await pool.totalFees()).to.equal(initialFees + expectedFee);
    expect(await pool.getPoolBalance()).to.equal(initialPoolBalance + expectedFee);
  });
});
