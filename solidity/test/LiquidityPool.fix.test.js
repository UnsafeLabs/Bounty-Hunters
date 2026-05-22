const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityPool Security Fix Verification", function () {
  let lp;
  let tokenA;
  let tokenB;
  let admin;
  let attacker;
  let victim;
  const MINIMUM_LIQUIDITY = 1000n;

  beforeEach(async function () {
    [admin, attacker, victim] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockToken");
    tokenA = await Token.deploy("Token A", "TKNA", ethers.parseEther("1000000"));
    tokenB = await Token.deploy("Token B", "TKNB", ethers.parseEther("1000000"));

    const LP = await ethers.getContractFactory("LiquidityPool");
    lp = await LP.deploy(await tokenA.getAddress(), await tokenB.getAddress());

    await tokenA.transfer(attacker.address, ethers.parseEther("10000"));
    await tokenB.transfer(attacker.address, ethers.parseEther("10000"));
    await tokenA.transfer(victim.address, ethers.parseEther("10000"));
    await tokenB.transfer(victim.address, ethers.parseEther("10000"));

    await tokenA.connect(attacker).approve(await lp.getAddress(), ethers.MaxUint256);
    await tokenB.connect(attacker).approve(await lp.getAddress(), ethers.MaxUint256);
    await tokenA.connect(victim).approve(await lp.getAddress(), ethers.MaxUint256);
    await tokenB.connect(victim).approve(await lp.getAddress(), ethers.MaxUint256);
  });

  it("Fix: First deposit locks MINIMUM_LIQUIDITY", async function () {
    const amount = 2000n;
    await lp.connect(attacker).addLiquidity(amount, amount);
    
    // sqrt(2000 * 2000) = 2000.
    // lpTokens = 2000 - 1000 = 1000.
    expect(await lp.totalSupply()).to.equal(2000);
    expect(await lp.balanceOf(attacker.address)).to.equal(1000);
    expect(await lp.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(1000);
  });

  it("Fix: First-depositor price manipulation (Inflation) is mitigated", async function () {
    // 1. Attacker deposits small amount
    // sqrt(2000*2000) = 2000. 1000 locked.
    await lp.connect(attacker).addLiquidity(2000, 2000);
    
    // 2. Attacker donates 100 tokens
    const donation = ethers.parseEther("100");
    await tokenA.connect(attacker).transfer(await lp.getAddress(), donation);
    await tokenB.connect(attacker).transfer(await lp.getAddress(), donation);

    // 3. Victim deposits
    // Even if reserves are synced (which happens on next addLiquidity), 
    // the MINIMUM_LIQUIDITY prevents the share from being 0 easily for reasonable deposits.
    const victimDeposit = ethers.parseEther("1"); // 1e18
    
    // Current state (before victim):
    // totalSupply = 2000
    // reserveA = 2000 (hasn't synced yet)
    
    // In addLiquidity for victim:
    // lpFromA = 1e18 * 2000 / 2000 = 1e18
    await lp.connect(victim).addLiquidity(victimDeposit, victimDeposit);
    
    expect(await lp.balanceOf(victim.address)).to.be.above(0);
  });

  it("Fix: removeLiquidity uses reserves and is not instantly manipulable", async function () {
    await lp.connect(attacker).addLiquidity(ethers.parseEther("10"), ethers.parseEther("10"));
    await lp.connect(victim).addLiquidity(ethers.parseEther("10"), ethers.parseEther("10"));

    const attackerLP = await lp.balanceOf(attacker.address);
    
    // Donate tokens
    await tokenA.transfer(await lp.getAddress(), ethers.parseEther("100"));
    
    // Attacker removes liquidity. 
    // Since it uses reserveA (which was 20e18), he only gets his fair share of the 20e18.
    const initialAttackerA = await tokenA.balanceOf(attacker.address);
    await lp.connect(attacker).removeLiquidity(attackerLP);
    const finalAttackerA = await tokenA.balanceOf(attacker.address);
    
    // He should get ~10e18, not ~60e18.
    // Calculation: 10e18 * 20e18 / 20e18 = 10e18. (Actually slightly less due to MINIMUM_LIQUIDITY)
    expect(finalAttackerA - initialAttackerA).to.be.closeTo(ethers.parseEther("10"), ethers.parseEther("0.1"));
  });

  it("Fix: sync() function updates reserves", async function () {
    await lp.connect(attacker).addLiquidity(ethers.parseEther("10"), ethers.parseEther("10"));
    
    const donation = ethers.parseEther("5");
    await tokenA.connect(attacker).transfer(await lp.getAddress(), donation);
    
    expect(await lp.reserveA()).to.equal(ethers.parseEther("10"));
    
    await expect(lp.sync())
      .to.emit(lp, "Sync")
      .withArgs(ethers.parseEther("15"), ethers.parseEther("10"));
      
    expect(await lp.reserveA()).to.equal(ethers.parseEther("15"));
  });
});
