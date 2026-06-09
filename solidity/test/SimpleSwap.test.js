const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SimpleSwap", function () {
  let tokenA;
  let tokenB;
  let swap;
  let owner;
  let user;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy Mock Tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tokenA = await MockERC20.deploy("Token A", "TKA");
    if (tokenA.waitForDeployment) {
      await tokenA.waitForDeployment();
    } else {
      await tokenA.deployed();
    }

    tokenB = await MockERC20.deploy("Token B", "TKB");
    if (tokenB.waitForDeployment) {
      await tokenB.waitForDeployment();
    } else {
      await tokenB.deployed();
    }

    // Deploy SimpleSwap with 30 basis points fee (0.3%)
    const SimpleSwap = await ethers.getContractFactory("SimpleSwap");
    const tokenAAddress = tokenA.target || tokenA.address;
    const tokenBAddress = tokenB.target || tokenB.address;
    swap = await SimpleSwap.deploy(tokenAAddress, tokenBAddress, 30);
    if (swap.waitForDeployment) {
      await swap.waitForDeployment();
    } else {
      await swap.deployed();
    }

    const swapAddress = swap.target || swap.address;

    // Mint and approve for adding liquidity
    await tokenA.mint(owner.address, ethers.parseEther("100000"));
    await tokenB.mint(owner.address, ethers.parseEther("100000"));
    await tokenA.approve(swapAddress, ethers.MaxUint256);
    await tokenB.approve(swapAddress, ethers.MaxUint256);

    // Mint and approve for user
    await tokenA.mint(user.address, ethers.parseEther("10000"));
    await tokenB.mint(user.address, ethers.parseEther("10000"));
    await tokenA.connect(user).approve(swapAddress, ethers.MaxUint256);
    await tokenB.connect(user).approve(swapAddress, ethers.MaxUint256);

    // Add liquidity: 10,000 TKA and 10,000 TKB
    await swap.addLiquidity(ethers.parseEther("10000"), ethers.parseEther("10000"));
  });

  it("should swap tokenA for tokenB successfully if within slippage and deadline", async function () {
    const amountIn = ethers.parseEther("100");
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const tokenAAddress = tokenA.target || tokenA.address;
    const expectedOut = await swap.getAmountOut(tokenAAddress, amountIn);

    const minAmountOut = expectedOut;

    const initialUserB = await tokenB.balanceOf(user.address);

    await expect(swap.connect(user).swap(tokenAAddress, amountIn, minAmountOut, deadline))
      .to.emit(swap, "Swap")
      .withArgs(user.address, tokenAAddress, amountIn, expectedOut);

    const finalUserB = await tokenB.balanceOf(user.address);
    expect(finalUserB - initialUserB).to.equal(expectedOut);
  });

  it("should revert if output is below minAmountOut", async function () {
    const amountIn = ethers.parseEther("100");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const tokenAAddress = tokenA.target || tokenA.address;

    // expectedOut is ~98.71 tokens. Setting minAmountOut to 99 tokens should fail.
    const minAmountOut = ethers.parseEther("99");

    await expect(
      swap.connect(user).swap(tokenAAddress, amountIn, minAmountOut, deadline)
    ).to.be.revertedWith("Slippage exceeded");
  });

  it("should revert if deadline has expired", async function () {
    const amountIn = ethers.parseEther("100");
    const tokenAAddress = tokenA.target || tokenA.address;
    const expiredDeadline = Math.floor(Date.now() / 1000) - 60; // 1 minute ago

    await expect(
      swap.connect(user).swap(tokenAAddress, amountIn, 0, expiredDeadline)
    ).to.be.revertedWith("Deadline expired");
  });

  it("should apply fee correctly to prevent precision loss / fee bypass on small amounts", async function () {
    const amountIn = 100n; // 100 wei (very small amount)
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const tokenAAddress = tokenA.target || tokenA.address;

    // If fee was calculated as: amountIn * fee / 10000
    // then feeAmount = 100 * 30 / 10000 = 0.
    // amountInAfterFee = 100.
    // amountOut = (reserveOut * 100) / (reserveIn + 100) = (10000 * 10^18 * 100) / (10000 * 10^18 + 100) = 100.
    // With proper fixed-point math:
    // amountInWithFee = 100 * 9970 = 997000
    // numerator = 997000 * 10000 * 10^18 = 9.97 * 10^27
    // denominator = 10000 * 10^18 * 10000 + 997000 = 100000000 * 10^18 + 997000
    // amountOut = 9.97 * 10^27 / (10^26 + 997000) = 99.
    // Let's call getAmountOut to see what it returns.
    const amountOut = await swap.getAmountOut(tokenAAddress, amountIn);
    
    // Proper math: 99. Without fee: 100. So the fee of 1 wei (1%) is correctly applied!
    // Wait, let's verify if the actual swap behaves the same.
    expect(amountOut).to.equal(99n);

    const initialUserB = await tokenB.balanceOf(user.address);
    await swap.connect(user).swap(tokenAAddress, amountIn, 0, deadline);
    const finalUserB = await tokenB.balanceOf(user.address);

    expect(finalUserB - initialUserB).to.equal(99n);
  });
});
