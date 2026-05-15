const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

const MINIMUM_LIQUIDITY = 1000n;

describe("LiquidityPool", function () {
  async function deployPool() {
    const [owner, first, second, donor] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("GovernanceToken");
    const tokenA = await Token.deploy(10_000_000n);
    const tokenB = await Token.deploy(10_000_000n);

    const Pool = await ethers.getContractFactory("LiquidityPool");
    const pool = await Pool.deploy(await tokenA.getAddress(), await tokenB.getAddress());
    const poolAddress = await pool.getAddress();

    for (const user of [first, second, donor]) {
      await tokenA.transfer(user.address, 2_000_000n);
      await tokenB.transfer(user.address, 2_000_000n);
      await tokenA.connect(user).approve(poolAddress, 2_000_000n);
      await tokenB.connect(user).approve(poolAddress, 2_000_000n);
    }

    return { owner, first, second, donor, tokenA, tokenB, pool, poolAddress };
  }

  it("locks MINIMUM_LIQUIDITY at address(0) on the first deposit", async function () {
    const { first, pool } = await deployPool();
    const deposit = 1_000_000n;

    await pool.connect(first).addLiquidity(deposit, deposit);

    assert.equal(await pool.balanceOf(ethers.ZeroAddress), MINIMUM_LIQUIDITY);
    assert.equal(await pool.balanceOf(first.address), deposit - MINIMUM_LIQUIDITY);
    assert.equal(await pool.totalSupply(), deposit);
    assert.equal(await pool.reserveA(), deposit);
    assert.equal(await pool.reserveB(), deposit);
  });

  it("rejects first deposits too small to absorb the permanent lock", async function () {
    const { first, pool } = await deployPool();

    await assert.rejects(
      pool.connect(first).addLiquidity(MINIMUM_LIQUIDITY, MINIMUM_LIQUIDITY),
      /Insufficient initial liquidity/
    );
  });

  it("mints later deposits from internal reserves instead of donated balances", async function () {
    const { first, second, donor, tokenA, tokenB, pool, poolAddress } = await deployPool();
    const seed = 1001n;
    const donation = 1_000_000n;

    await pool.connect(first).addLiquidity(seed, seed);
    assert.equal(await pool.balanceOf(first.address), 1n);

    await tokenA.connect(donor).transfer(poolAddress, donation);
    await tokenB.connect(donor).transfer(poolAddress, donation);

    await pool.connect(second).addLiquidity(seed, seed);

    assert.equal(await pool.balanceOf(second.address), seed);
    assert.equal(await pool.reserveA(), seed * 2n);
    assert.equal(await pool.reserveB(), seed * 2n);
    assert.equal(await tokenA.balanceOf(poolAddress), donation + seed * 2n);
    assert.equal(await tokenB.balanceOf(poolAddress), donation + seed * 2n);
  });

  it("removes liquidity using internal reserves so direct donations cannot be stolen", async function () {
    const { first, donor, tokenA, tokenB, pool, poolAddress } = await deployPool();
    const deposit = 1_000_000n;
    const donation = 500_000n;

    await pool.connect(first).addLiquidity(deposit, deposit);
    await tokenA.connect(donor).transfer(poolAddress, donation);
    await tokenB.connect(donor).transfer(poolAddress, donation);

    const lpBalance = await pool.balanceOf(first.address);
    const [amountA, amountB] = await pool.connect(first).removeLiquidity.staticCall(lpBalance);

    assert.equal(amountA, deposit - MINIMUM_LIQUIDITY);
    assert.equal(amountB, deposit - MINIMUM_LIQUIDITY);

    await pool.connect(first).removeLiquidity(lpBalance);

    assert.equal(await pool.reserveA(), MINIMUM_LIQUIDITY);
    assert.equal(await pool.reserveB(), MINIMUM_LIQUIDITY);
    assert.equal(await tokenA.balanceOf(poolAddress), donation + MINIMUM_LIQUIDITY);
    assert.equal(await tokenB.balanceOf(poolAddress), donation + MINIMUM_LIQUIDITY);
  });

  it("syncs reserves to actual balances after an explicit recovery call", async function () {
    const { first, donor, tokenA, tokenB, pool, poolAddress } = await deployPool();
    const deposit = 1_000_000n;
    const donationA = 500_000n;
    const donationB = 250_000n;

    await pool.connect(first).addLiquidity(deposit, deposit);
    await tokenA.connect(donor).transfer(poolAddress, donationA);
    await tokenB.connect(donor).transfer(poolAddress, donationB);

    assert.equal(await pool.reserveA(), deposit);
    assert.equal(await pool.reserveB(), deposit);

    const receipt = await (await pool.sync()).wait();
    const syncEvent = receipt.logs
      .map((log) => {
        try {
          return pool.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((event) => event && event.name === "Sync");

    assert(syncEvent);
    assert.equal(syncEvent.args.reserveA, deposit + donationA);
    assert.equal(syncEvent.args.reserveB, deposit + donationB);
    assert.equal(await pool.reserveA(), deposit + donationA);
    assert.equal(await pool.reserveB(), deposit + donationB);

    const lpBalance = await pool.balanceOf(first.address);
    const [amountA, amountB] = await pool.connect(first).removeLiquidity.staticCall(lpBalance);
    assert.equal(amountA, (lpBalance * (deposit + donationA)) / deposit);
    assert.equal(amountB, (lpBalance * (deposit + donationB)) / deposit);
  });
});
