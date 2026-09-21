import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";

describe("LiquidityPool", function () {
  let tokenA: Contract;
  let tokenB: Contract;
  let pool: Contract;
  let owner: Signer;
  let attacker: Signer;
  const MINIMUM_LIQUIDITY = ethers.BigNumber.from(1000);

  beforeEach(async function () {
    [owner, attacker] = await ethers.getSigners();

    // Deploy two mock ERC20 tokens
    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    tokenA = await ERC20Mock.deploy("Token A", "TKA", await owner.getAddress(), ethers.utils.parseEther("1000000"));
    tokenB = await ERC20Mock.deploy("Token B", "TKB", await owner.getAddress(), ethers.utils.parseEther("1000000"));
    await tokenA.deployed();
    await tokenB.deployed();

    // Deploy the LiquidityPool
    const LiquidityPool = await ethers.getContractFactory("LiquidityPool");
    pool = await LiquidityPool.deploy(tokenA.address, tokenB.address);
    await pool.deployed();

    // Approve pool to spend owner's tokens
    await tokenA.approve(pool.address, ethers.constants.MaxUint256);
    await tokenB.approve(pool.address, ethers.constants.MaxUint256);
  });

  it("locks MINIMUM_LIQUIDITY on first deposit", async function () {
    const amount = ethers.utils.parseEther("10");
    await pool.addLiquidity(amount, amount);

    const totalSupply = await pool.totalSupply();
    const balanceZero = await pool.balanceOf(ethers.constants.AddressZero);
    const ownerBalance = await pool.balanceOf(await owner.getAddress());

    expect(balanceZero).to.equal(MINIMUM_LIQUIDITY);
    expect(totalSupply).to.equal(balanceZero.add(ownerBalance));
    // Owner should receive totalSupply - MINIMUM_LIQUIDITY
    expect(ownerBalance).to.equal(totalSupply.sub(MINIMUM_LIQUIDITY));
  });

  it("prevents price manipulation via first tiny deposit", async function () {
    // Attacker makes a tiny first deposit
    const tiny = ethers.utils.parseUnits("1", 0); // 1 wei
    await tokenA.transfer(attacker.getAddress(), tiny);
    await tokenB.transfer(attacker.getAddress(), tiny);
    await tokenA.connect(attacker).approve(pool.address, tiny);
    await tokenB.connect(attacker).approve(pool.address, tiny);
    await pool.connect(attacker).addLiquidity(tiny, tiny);

    // Attacker now donates a huge amount directly to the pool (no addLiquidity)
    const huge = ethers.utils.parseEther("10000");
    await tokenA.transfer(pool.address, huge);
    await tokenB.transfer(pool.address, huge);

    // Without sync, reserves would be stale – call sync to recover
    await pool.sync();

    // After sync, reserves reflect the huge donation, but LP price stays the same
    const reserves = await pool.getReserves();
    expect(reserves[0]).to.equal(tiny.add(huge));
    expect(reserves[1]).to.equal(tiny.add(huge));

    // Owner adds proper liquidity after sync – should receive correct amount of LP tokens
    const addAmt = ethers.utils.parseEther("10");
    await pool.addLiquidity(addAmt, addAmt);
    const newTotalSupply = await pool.totalSupply();

    // The price (token per LP) should be roughly unchanged compared to a fresh pool
    const pricePerLP = addAmt.mul(ethers.constants.WeiPerEther).div(newTotalSupply.sub(MINIMUM_LIQUIDITY));
    expect(pricePerLP).to.be.gt(0);
  });

  it("removeLiquidity uses internal reserves, not balanceOf", async function () {
    const amount = ethers.utils.parseEther("100");
    await pool.addLiquidity(amount, amount);

    const lpBalance = await pool.balanceOf(await owner.getAddress());
    const totalSupplyBefore = await pool.totalSupply();

    // Directly transfer extra tokens to the pool to try to skew balanceOf
    const extra = ethers.utils.parseEther("50");
    await tokenA.transfer(pool.address, extra);
    await tokenB.transfer(pool.address, extra);

    // Remove half of the LP tokens
    const halfLP = lpBalance.div(2);
    await pool.removeLiquidity(halfLP);

    // Expected amounts are based on reserves (which should ignore the extra donation)
    const reserves = await pool.getReserves();
    const expected0 = halfLP.mul(reserves[0]).div(totalSupplyBefore);
    const expected1 = halfLP.mul(reserves[1]).div(totalSupplyBefore);

    const ownerTokenABalance = await tokenA.balanceOf(await owner.getAddress());
    const ownerTokenBBalance = await tokenB.balanceOf(await owner.getAddress());

    // Owner should have received amounts close to expected (allow small rounding)
    expect(ownerTokenABalance).to.be.closeTo(expected0, ethers.utils.parseUnits("1", 12));
    expect(ownerTokenBBalance).to.be.closeTo(expected1, ethers.utils.parseUnits("1", 12));
  });
});
