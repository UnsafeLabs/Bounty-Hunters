const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityPool", function () {
  let TokenA, TokenB, LiquidityPool;
  let tokenA, tokenB, pool;
  let owner, user1, user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    tokenA = await ERC20Mock.deploy("Token A", "TKA", ethers.parseEther("1000000"));
    tokenB = await ERC20Mock.deploy("Token B", "TKB", ethers.parseEther("1000000"));

    const LiquidityPoolFactory = await ethers.getContractFactory("LiquidityPool");
    pool = await LiquidityPoolFactory.deploy(tokenA.target, tokenB.target);

    await tokenA.transfer(user1.address, ethers.parseEther("10000"));
    await tokenB.transfer(user1.address, ethers.parseEther("10000"));
    await tokenA.transfer(user2.address, ethers.parseEther("10000"));
    await tokenB.transfer(user2.address, ethers.parseEther("10000"));
  });

  describe("Initial deposit lock", function () {
    it("should lock MINIMUM_LIQUIDITY on first deposit", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");

      await tokenA.connect(user1).approve(pool.target, amountA);
      await tokenB.connect(user1).approve(pool.target, amountB);

      await pool.connect(user1).addLiquidity(amountA, amountB);

      // Total supply should be sqrt(10*10) = 10 ether
      const totalSupply = await pool.totalSupply();
      expect(totalSupply).to.equal(ethers.parseEther("10"));

      // address(0) should receive MINIMUM_LIQUIDITY (1000)
      const lockBalance = await pool.balanceOf(ethers.ZeroAddress);
      expect(lockBalance).to.equal(1000n);

      // User should receive the rest
      const userBalance = await pool.balanceOf(user1.address);
      expect(userBalance).to.equal(ethers.parseEther("10") - 1000n);
    });
  });

  describe("Price manipulation and donation attacks", function () {
    it("should prevent donation attack from affecting price", async function () {
      // Setup initial liquidity
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");

      await tokenA.connect(user1).approve(pool.target, amountA);
      await tokenB.connect(user1).approve(pool.target, amountB);
      await pool.connect(user1).addLiquidity(amountA, amountB);

      // User2 tries to manipulate the pool by donating a massive amount of tokenA directly
      const donationA = ethers.parseEther("1000");
      await tokenA.connect(user2).transfer(pool.target, donationA);

      // The internal reserves should NOT reflect the donation yet
      expect(await pool.reserveA()).to.equal(amountA);

      // Removing liquidity should be based on reserves, not balanceOf
      const user1LP = await pool.balanceOf(user1.address);
      const balABefore = await tokenA.balanceOf(user1.address);
      const balBBefore = await tokenB.balanceOf(user1.address);

      await pool.connect(user1).removeLiquidity(user1LP);

      const balAAfter = await tokenA.balanceOf(user1.address);
      const balBAfter = await tokenB.balanceOf(user1.address);

      // User1 gets back their fair share of the RESERVES, not the donated amount
      // amountA returned = user1LP * reserveA / totalSupply
      const expectedAmountA = (user1LP * amountA) / ethers.parseEther("10");
      
      expect(balAAfter - balABefore).to.equal(expectedAmountA);
    });
  });

  describe("sync recovery", function () {
    it("should sync reserves with actual balances", async function () {
      const amountA = ethers.parseEther("10");
      const amountB = ethers.parseEther("10");

      await tokenA.connect(user1).approve(pool.target, amountA);
      await tokenB.connect(user1).approve(pool.target, amountB);
      await pool.connect(user1).addLiquidity(amountA, amountB);

      // Direct donation
      const donationA = ethers.parseEther("100");
      await tokenA.connect(user2).transfer(pool.target, donationA);

      expect(await pool.reserveA()).to.equal(amountA);

      // Call sync
      await expect(pool.sync())
        .to.emit(pool, "Sync")
        .withArgs(amountA + donationA, amountB);

      expect(await pool.reserveA()).to.equal(amountA + donationA);
    });
  });
});
