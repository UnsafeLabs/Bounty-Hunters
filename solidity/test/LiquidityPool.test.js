const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityPool", function () {
  let tokenA;
  let tokenB;
  let pool;
  let owner;
  let provider;
  let attacker;

  beforeEach(async function () {
    [owner, provider, attacker] = await ethers.getSigners();

    // Deploy Mock Tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tokenA = await MockERC20.deploy("Token A", "TKA");
    await tokenA.waitForDeployment();

    tokenB = await MockERC20.deploy("Token B", "TKB");
    await tokenB.waitForDeployment();

    // Deploy LiquidityPool
    const LiquidityPool = await ethers.getContractFactory("LiquidityPool");
    const tokenAAddress = tokenA.target || tokenA.address;
    const tokenBAddress = tokenB.target || tokenB.address;
    pool = await LiquidityPool.deploy(tokenAAddress, tokenBAddress);
    await pool.waitForDeployment();

    const poolAddress = pool.target || pool.address;

    // Set up provider balances and approvals
    await tokenA.mint(provider.address, ethers.parseEther("100000"));
    await tokenB.mint(provider.address, ethers.parseEther("100000"));
    await tokenA.connect(provider).approve(poolAddress, ethers.MaxUint256);
    await tokenB.connect(provider).approve(poolAddress, ethers.MaxUint256);

    // Set up attacker balances and approvals
    await tokenA.mint(attacker.address, ethers.parseEther("100000"));
    await tokenB.mint(attacker.address, ethers.parseEther("100000"));
    await tokenA.connect(attacker).approve(poolAddress, ethers.MaxUint256);
    await tokenB.connect(attacker).approve(poolAddress, ethers.MaxUint256);
  });

  it("should enforce MINIMUM_LIQUIDITY lock to address(0) on first deposit", async function () {
    const amountA = 10000n;
    const amountB = 10000n;

    // First depositor adds liquidity
    await expect(pool.connect(provider).addLiquidity(amountA, amountB))
      .to.emit(pool, "LiquidityAdded")
      .withArgs(provider.address, amountA, amountB, 9000n);

    // Verify balances
    expect(await pool.balanceOf(ethers.ZeroAddress)).to.equal(1000n);
    expect(await pool.balanceOf(provider.address)).to.equal(9000n);
    expect(await pool.totalSupply()).to.equal(10000n);
  });

  it("should fail first deposit if liquidity is less than MINIMUM_LIQUIDITY", async function () {
    // sqrt(900 * 900) = 900 < 1000 (MINIMUM_LIQUIDITY)
    await expect(
      pool.connect(provider).addLiquidity(900n, 900n)
    ).to.be.revertedWith("Insufficient initial liquidity");
  });

  it("should mint proportional LP tokens on subsequent deposits", async function () {
    // First deposit: 10,000 LP tokens created (1,000 locked, 9,000 to provider)
    await pool.connect(provider).addLiquidity(10000n, 10000n);

    // Second deposit: 5,000 of each
    // lpFromA = 5,000 * 10,000 / 10,000 = 5,000
    await expect(pool.connect(attacker).addLiquidity(5000n, 5000n))
      .to.emit(pool, "LiquidityAdded")
      .withArgs(attacker.address, 5000n, 5000n, 5000n);

    expect(await pool.balanceOf(attacker.address)).to.equal(5000n);
    expect(await pool.totalSupply()).to.equal(15000n);
  });

  it("should prevent donation attacks from affecting LP token withdraw pricing", async function () {
    const poolAddress = pool.target || pool.address;

    // First deposit: 10,000 LP tokens created (9,000 to provider)
    await pool.connect(provider).addLiquidity(10000n, 10000n);

    // Attacker donates 10,000 of Token A directly to the pool contract
    await tokenA.connect(attacker).transfer(poolAddress, 10000n);

    // Check balances on contract vs reserves
    expect(await tokenA.balanceOf(poolAddress)).to.equal(20000n);
    expect(await pool.reserveA()).to.equal(10000n);

    // Provider removes liquidity
    // Proportional share using internal reserves:
    // amountA = 9000 * 10000 / 10000 = 9000
    const initialBalanceA = await tokenA.balanceOf(provider.address);
    const initialBalanceB = await tokenB.balanceOf(provider.address);

    await pool.connect(provider).removeLiquidity(9000n);

    const finalBalanceA = await tokenA.balanceOf(provider.address);
    const finalBalanceB = await tokenB.balanceOf(provider.address);

    // Provider gets exactly 9000 tokens of each, proving donation did not affect pricing
    expect(finalBalanceA - initialBalanceA).to.equal(9000n);
    expect(finalBalanceB - initialBalanceB).to.equal(9000n);
  });

  it("should support sync recovery to update reserves to match token balances", async function () {
    const poolAddress = pool.target || pool.address;

    // First deposit
    await pool.connect(provider).addLiquidity(10000n, 10000n);

    // Attacker donates 10,000 of Token A
    await tokenA.connect(attacker).transfer(poolAddress, 10000n);

    // Call sync
    await expect(pool.sync())
      .to.emit(pool, "Sync")
      .withArgs(20000n, 10000n);

    // Verify reserves are updated
    expect(await pool.reserveA()).to.equal(20000n);
    expect(await pool.reserveB()).to.equal(10000n);
  });
});
