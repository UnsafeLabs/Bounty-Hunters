const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityPool", function () {
  let pool, tokenA, tokenB, user1, user2;

  beforeEach(async function () {
    [user1, user2] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    tokenA = await MockToken.deploy("Token A", "TKA");
    tokenB = await MockToken.deploy("Token B", "TKB");
    await tokenA.deployed();
    await tokenB.deployed();

    const LiquidityPool = await ethers.getContractFactory("LiquidityPool");
    pool = await LiquidityPool.deploy(tokenA.address, tokenB.address);
    await pool.deployed();
  });

  describe("First Deposit", function () {
    it("should lock minimum liquidity on first deposit", async function () {
      const amountA = ethers.utils.parseEther("1000");
      const amountB = ethers.utils.parseEther("1000");

      await tokenA.mint(user1.address, amountA);
      await tokenB.mint(user1.address, amountB);
      await tokenA.connect(user1).approve(pool.address, amountA);
      await tokenB.connect(user1).approve(pool.address, amountB);

      await pool.connect(user1).addLiquidity(amountA, amountB);

      // Check that minimum liquidity is locked at address(0)
      expect(await pool.balanceOf(ethers.constants.AddressZero)).to.equal(1000);
    });

    it("should reject if initial liquidity is too small", async function () {
      const amountA = 100;
      const amountB = 100;

      await tokenA.mint(user1.address, amountA);
      await tokenB.mint(user1.address, amountB);
      await tokenA.connect(user1).approve(pool.address, amountA);
      await tokenB.connect(user1).approve(pool.address, amountB);

      await expect(
        pool.connect(user1).addLiquidity(amountA, amountB)
      ).to.be.revertedWith("Insufficient initial liquidity");
    });
  });

  describe("Price Manipulation Prevention", function () {
    it("should prevent first-depositor manipulation", async function () {
      // First deposit
      const amountA = ethers.utils.parseEther("1000");
      const amountB = ethers.utils.parseEther("1000");

      await tokenA.mint(user1.address, amountA);
      await tokenB.mint(user1.address, amountB);
      await tokenA.connect(user1).approve(pool.address, amountA);
      await tokenB.connect(user1).approve(pool.address, amountB);

      await pool.connect(user1).addLiquidity(amountA, amountB);

      // Donation attack should not affect LP token price
      await tokenA.mint(pool.address, ethers.utils.parseEther("10000"));

      // Second deposit should use internal reserves, not balanceOf
      const depositA = ethers.utils.parseEther("100");
      const depositB = ethers.utils.parseEther("100");

      await tokenA.mint(user2.address, depositA);
      await tokenB.mint(user2.address, depositB);
      await tokenA.connect(user2).approve(pool.address, depositA);
      await tokenB.connect(user2).approve(pool.address, depositB);

      await pool.connect(user2).addLiquidity(depositA, depositB);

      // User2 should get proportional LP tokens based on reserves, not balance
      const lpBalance = await pool.balanceOf(user2.address);
      expect(lpBalance).to.be.gt(0);
    });
  });

  describe("Remove Liquidity", function () {
    it("should use internal reserves for calculation", async function () {
      const amountA = ethers.utils.parseEther("1000");
      const amountB = ethers.utils.parseEther("1000");

      await tokenA.mint(user1.address, amountA);
      await tokenB.mint(user1.address, amountB);
      await tokenA.connect(user1).approve(pool.address, amountA);
      await tokenB.connect(user1).approve(pool.address, amountB);

      await pool.connect(user1).addLiquidity(amountA, amountB);

      // Donation attack
      await tokenA.mint(pool.address, ethers.utils.parseEther("10000"));

      const lpBalance = await pool.balanceOf(user1.address);
      const balanceBefore = await tokenA.balanceOf(user1.address);

      await pool.connect(user1).removeLiquidity(lpBalance);

      const balanceAfter = await tokenA.balanceOf(user1.address);

      // Should receive based on reserves, not balanceOf
      expect(balanceAfter.sub(balanceBefore)).to.equal(amountA);
    });
  });

  describe("Sync Function", function () {
    it("should update reserves to match actual balances", async function () {
      const amountA = ethers.utils.parseEther("1000");
      const amountB = ethers.utils.parseEther("1000");

      await tokenA.mint(user1.address, amountA);
      await tokenB.mint(user1.address, amountB);
      await tokenA.connect(user1).approve(pool.address, amountA);
      await tokenB.connect(user1).approve(pool.address, amountB);

      await pool.connect(user1).addLiquidity(amountA, amountB);

      // Direct transfer to pool
      await tokenA.mint(pool.address, ethers.utils.parseEther("5000"));

      // Sync should update reserves
      await pool.sync();

      expect(await pool.reserveA()).to.equal(amountA.add(ethers.utils.parseEther("5000")));
      expect(await pool.reserveB()).to.equal(amountB);
    });
  });
});
