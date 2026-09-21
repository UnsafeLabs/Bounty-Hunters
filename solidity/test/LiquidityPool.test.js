const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityPool first-depositor hardening (#918)", function () {
  let pool, tokenA, tokenB;
  let provider, attacker, other;

  const MINIMUM_LIQUIDITY = 1000n;

  async function deploy() {
    const Mock = await ethers.getContractFactory("MockERC20");
    tokenA = await Mock.deploy();
    await tokenA.waitForDeployment();
    tokenB = await Mock.deploy();
    await tokenB.waitForDeployment();

    const Pool = await ethers.getContractFactory("LiquidityPool");
    pool = await Pool.deploy(await tokenA.getAddress(), await tokenB.getAddress());
    await pool.waitForDeployment();

    for (const user of [provider, attacker, other]) {
      await tokenA.mint(user.address, ethers.parseEther("1000000"));
      await tokenB.mint(user.address, ethers.parseEther("1000000"));
      await tokenA.connect(user).approve(await pool.getAddress(), ethers.MaxUint256);
      await tokenB.connect(user).approve(await pool.getAddress(), ethers.MaxUint256);
    }
  }

  beforeEach(async function () {
    [provider, attacker, other] = await ethers.getSigners();
    await deploy();
  });

  it("first deposit locks MINIMUM_LIQUIDITY at address(0)", async function () {
    const amount = ethers.parseEther("10000");
    await pool.connect(provider).addLiquidity(amount, amount);

    expect(await pool.balanceOf(ethers.ZeroAddress)).to.equal(MINIMUM_LIQUIDITY);

    // sqrt(10000e18 * 10000e18) = 10000e18
    const expectedUser = amount - MINIMUM_LIQUIDITY;
    expect(await pool.balanceOf(provider.address)).to.equal(expectedUser);
    expect(await pool.totalSupply()).to.equal(amount);
  });

  it("rejects first deposit with liquidity <= MINIMUM_LIQUIDITY", async function () {
    // sqrt(1*1)=1 which is < 1000
    await expect(pool.connect(provider).addLiquidity(1n, 1n)).to.be.revertedWith(
      "Insufficient initial liquidity"
    );
  });

  it("subsequent deposits use proportional formula from reserves", async function () {
    const first = ethers.parseEther("1000");
    await pool.connect(provider).addLiquidity(first, first);

    const second = ethers.parseEther("500");
    const supplyBefore = await pool.totalSupply();
    const reserveA = await pool.reserveA();

    await pool.connect(other).addLiquidity(second, second);

    const expectedLp = (second * supplyBefore) / reserveA;
    expect(await pool.balanceOf(other.address)).to.equal(expectedLp);
  });

  it("removeLiquidity uses internal reserves, not balanceOf", async function () {
    const amount = ethers.parseEther("1000");
    await pool.connect(provider).addLiquidity(amount, amount);

    const lp = await pool.balanceOf(provider.address);
    const half = lp / 2n;

    const reserveABefore = await pool.reserveA();
    const supply = await pool.totalSupply();
    const expectedA = (half * reserveABefore) / supply;

    await pool.connect(provider).removeLiquidity(half);

    // Provider received based on reserves
    // (balance increased by expectedA relative to post-deposit balance - check delta via mint setup is messy;
    // instead verify reserves dropped by expected amounts)
    expect(await pool.reserveA()).to.equal(reserveABefore - expectedA);
  });

  it("direct token donation does not inflate removeLiquidity payout", async function () {
    const amount = ethers.parseEther("1000");
    await pool.connect(provider).addLiquidity(amount, amount);

    // Attacker donates a large amount of tokenA directly
    const donation = ethers.parseEther("50000");
    await tokenA.connect(attacker).transfer(await pool.getAddress(), donation);

    // Actual balance >> reserveA, but removeLiquidity should use reserves
    const poolBalA = await tokenA.balanceOf(await pool.getAddress());
    expect(poolBalA).to.be.gt(await pool.reserveA());

    const lp = await pool.balanceOf(provider.address);
    const reserveA = await pool.reserveA();
    const supply = await pool.totalSupply();
    const expectedA = (lp * reserveA) / supply;

    const before = await tokenA.balanceOf(provider.address);
    await pool.connect(provider).removeLiquidity(lp);
    const after = await tokenA.balanceOf(provider.address);

    expect(after - before).to.equal(expectedA);
    // Donation remains in the pool (not paid out)
    expect(await tokenA.balanceOf(await pool.getAddress())).to.equal(donation + 1000n); // locked MINIMUM_LIQUIDITY dust remains
  });

  it("sync recovers reserves after donation", async function () {
    const amount = ethers.parseEther("1000");
    await pool.connect(provider).addLiquidity(amount, amount);

    const donation = ethers.parseEther("12345");
    await tokenA.connect(attacker).transfer(await pool.getAddress(), donation);

    expect(await pool.reserveA()).to.equal(amount);

    await expect(pool.sync())
      .to.emit(pool, "Sync")
      .withArgs(amount + donation, amount);

    expect(await pool.reserveA()).to.equal(amount + donation);
    expect(await pool.reserveB()).to.equal(amount);
  });

  it("first-depositor tiny deposit + donation cannot steal subsequent deposit", async function () {
    // Attacker seeds with minimum viable first deposit
    const seed = ethers.parseEther("1"); // sqrt = 1e18 >> 1000
    await pool.connect(attacker).addLiquidity(seed, seed);
    expect(await pool.balanceOf(ethers.ZeroAddress)).to.equal(MINIMUM_LIQUIDITY);

    // Donate huge amount of tokenA to skew balanceOf-based pricing (old bug)
    await tokenA.connect(attacker).transfer(await pool.getAddress(), ethers.parseEther("100000"));

    // Victim deposits equal amounts; pricing uses reserves so they get fair share
    const victimAmt = ethers.parseEther("100");
    const supplyBefore = await pool.totalSupply();
    const reserveA = await pool.reserveA();
    await pool.connect(provider).addLiquidity(victimAmt, victimAmt);

    const expectedLp = (victimAmt * supplyBefore) / reserveA;
    expect(await pool.balanceOf(provider.address)).to.equal(expectedLp);
  });

  it("addLiquidity emits Sync with updated reserves", async function () {
    const amount = ethers.parseEther("1000");
    await expect(pool.connect(provider).addLiquidity(amount, amount))
      .to.emit(pool, "Sync")
      .withArgs(amount, amount);
  });

  it("locked MINIMUM_LIQUIDITY cannot be redeemed by first depositor", async function () {
    const amount = ethers.parseEther("1000");
    await pool.connect(provider).addLiquidity(amount, amount);
    const userLp = await pool.balanceOf(provider.address);
    // Burn all user LP — locked 1000 remains, reserves retain proportional dust
    await pool.connect(provider).removeLiquidity(userLp);
    expect(await pool.balanceOf(ethers.ZeroAddress)).to.equal(MINIMUM_LIQUIDITY);
    expect(await pool.totalSupply()).to.equal(MINIMUM_LIQUIDITY);
    expect(await pool.reserveA()).to.equal(MINIMUM_LIQUIDITY);
    expect(await pool.reserveB()).to.equal(MINIMUM_LIQUIDITY);
  });
});
