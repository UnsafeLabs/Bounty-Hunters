import { expect } from "chai";
import { ethers } from "hardhat";

describe("LiquidityPool", function () {
  let tokenA, tokenB, pool, owner, attacker;

  beforeEach(async function () {
    [owner, attacker] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ERC20Mock");
    tokenA = await Token.deploy("Token A", "TKA", 18);
    tokenB = await Token.deploy("Token B", "TKB", 18);
    await tokenA.waitForDeployment();
    await tokenB.waitForDeployment();

    const LiquidityPool = await ethers.getContractFactory("LiquidityPool");
    pool = await LiquidityPool.deploy(await tokenA.getAddress(), await tokenB.getAddress());
    await pool.waitForDeployment();
  });

  it("should lock MINIMUM_LIQUIDITY on first deposit", async function () {
    const amountA = ethers.parseEther("1000");
    const amountB = ethers.parseEther("1000");
    await tokenA.mint(owner.address, amountA);
    await tokenB.mint(owner.address, amountB);
    await tokenA.connect(owner).approve(await pool.getAddress(), amountA);
    await tokenB.connect(owner).approve(await pool.getAddress(), amountB);

    await pool.connect(owner).addLiquidity(amountA, amountB);
    const MINIMUM_LIQUIDITY = await pool.MINIMUM_LIQUIDITY();
    const lockedBalance = await pool.balanceOf(ethers.ZeroAddress);
    expect(lockedBalance).to.equal(MINIMUM_LIQUIDITY);
  });

  it("should prevent first-depositor price manipulation", async function () {
    const amountA = ethers.parseEther("1");
    const amountB = ethers.parseEther("1");
    await tokenA.mint(attacker.address, amountA);
    await tokenB.mint(attacker.address, amountB);
    await tokenA.connect(attacker).approve(await pool.getAddress(), amountA);
    await tokenB.connect(attacker).approve(await pool.getAddress(), amountB);

    await pool.connect(attacker).addLiquidity(amountA, amountB);
    const lpAfterFirst = await pool.balanceOf(attacker.address);

    await tokenA.mint(attacker.address, ethers.parseEther("10000"));
    await tokenB.mint(attacker.address, ethers.parseEther("10000"));
    await tokenA.connect(attacker).approve(await pool.getAddress(), ethers.parseEther("10000"));
    await tokenB.connect(attacker).approve(await pool.getAddress(), ethers.parseEther("10000"));
    await pool.connect(attacker).addLiquidity(ethers.parseEther("10000"), ethers.parseEther("10000"));

    const lpAfterSecond = await pool.balanceOf(attacker.address);
    expect(lpAfterSecond).to.be.gt(lpAfterFirst);
  });

  it("should use internal reserves in removeLiquidity", async function () {
    const amountA = ethers.parseEther("1000");
    const amountB = ethers.parseEther("1000");
    await tokenA.mint(owner.address, amountA);
    await tokenB.mint(owner.address, amountB);
    await tokenA.connect(owner).approve(await pool.getAddress(), amountA);
    await tokenB.connect(owner).approve(await pool.getAddress(), amountB);

    await pool.connect(owner).addLiquidity(amountA, amountB);
    const lpBalance = await pool.balanceOf(owner.address);

    await tokenA.mint(await pool.getAddress(), ethers.parseEther("500"));
    const prevReserveA = await pool.reserveA();
    await pool.connect(owner).removeLiquidity(lpBalance);
    const finalReserveA = await pool.reserveA();
    expect(finalReserveA).to.be.lessThan(prevReserveA);
  });

  it("should sync reserves after donation", async function () {
    const amountA = ethers.parseEther("1000");
    const amountB = ethers.parseEther("1000");
    await tokenA.mint(owner.address, amountA);
    await tokenB.mint(owner.address, amountB);
    await tokenA.connect(owner).approve(await pool.getAddress(), amountA);
    await tokenB.connect(owner).approve(await pool.getAddress(), amountB);
    await pool.connect(owner).addLiquidity(amountA, amountB);

    await tokenA.mint(await pool.getAddress(), ethers.parseEther("100"));
    await pool.sync();
    const syncedA = await pool.reserveA();
    expect(syncedA).to.equal(ethers.parseEther("1100"));
  });
});
