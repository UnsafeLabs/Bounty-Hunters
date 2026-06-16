const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SimpleSwap", function () {
  let swap;
  let tokenA;
  let tokenB;
  let owner;
  let user;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    tokenA = await MockToken.deploy("Token A", "TKA", 18);
    tokenB = await MockToken.deploy("Token B", "TKB", 18);

    const SimpleSwap = await ethers.getContractFactory("SimpleSwap");
    swap = await SimpleSwap.deploy(tokenA.address, tokenB.address, 30); // 0.3% fee

    await tokenA.mint(owner.address, ethers.utils.parseEther("1000"));
    await tokenB.mint(owner.address, ethers.utils.parseEther("1000"));
    await tokenA.approve(swap.address, ethers.utils.parseEther("1000"));
    await tokenB.approve(swap.address, ethers.utils.parseEther("1000"));
    
    await swap.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("100"));
  });

  it("should swap with slippage protection", async function () {
    await tokenA.mint(user.address, ethers.utils.parseEther("10"));
    await tokenA.connect(user).approve(swap.address, ethers.utils.parseEther("10"));
    
    const amountIn = ethers.utils.parseEther("1");
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    
    // Expected out: (100 * 0.997) / (100 + 0.997) = 0.997 / 100.997 = ~0.00987...
    const amountOut = await swap.getAmountOut(tokenA.address, amountIn);
    
    await expect(swap.connect(user).swap(tokenA.address, amountIn, amountOut, deadline))
      .to.emit(swap, "Swap");
  });

  it("should revert if slippage exceeded", async function () {
    await tokenA.mint(user.address, ethers.utils.parseEther("10"));
    await tokenA.connect(user).approve(swap.address, ethers.utils.parseEther("10"));
    
    const amountIn = ethers.utils.parseEther("1");
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    const amountOut = await swap.getAmountOut(tokenA.address, amountIn);
    
    await expect(swap.connect(user).swap(tokenA.address, amountIn, amountOut.add(1), deadline))
      .to.be.revertedWith("Slippage exceeded");
  });

  it("should revert if deadline passed", async function () {
    const amountIn = ethers.utils.parseEther("1");
    const deadline = (await ethers.provider.getBlock("latest")).timestamp - 1;
    
    await expect(swap.connect(user).swap(tokenA.address, amountIn, 0, deadline))
      .to.be.revertedWith("Expired transaction");
  });
});
