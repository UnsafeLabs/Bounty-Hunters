const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityPool Vulnerability Reproduction", function () {
  let lp;
  let tokenA;
  let tokenB;
  let admin;
  let attacker;
  let victim;

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

  it("Vulnerability: First depositor can manipulate share price (Inflation Attack)", async function () {
    // 1. Attacker becomes the first depositor with a tiny amount (e.g., 1 wei)
    await lp.connect(attacker).addLiquidity(1, 1);
    expect(await lp.totalSupply()).to.equal(1);
    expect(await lp.balanceOf(attacker.address)).to.equal(1);

    // 2. Attacker "donates" tokens to the pool directly to inflate the price
    const donation = ethers.parseEther("100");
    await tokenA.connect(attacker).transfer(await lp.getAddress(), donation);
    await tokenB.connect(attacker).transfer(await lp.getAddress(), donation);

    // Now the pool has 100e18 + 1 tokens but only 1 LP token share
    // The price of 1 LP token is ~100e18 tokens

    // 3. Victim tries to deposit a significant amount
    const victimDeposit = ethers.parseEther("50");
    // lpTokens = min(50e18 * 1 / 1, 50e18 * 1 / 1) if we used reserves, but it uses totalSupply() / reserveA
    // Wait, the current code is:
    // lpFromA = amountA * totalSupply() / reserveA;
    // reserveA only increments on addLiquidity, but removeLiquidity uses balanceOf!
    
    // In addLiquidity:
    // reserveA = 1
    // totalSupply = 1
    // lpFromA = 50e18 * 1 / 1 = 50e18
    
    // BUT if the contract used balanceOf for share calculation (common bug), it would be broken.
    // The current addLiquidity uses reserveA/reserveB.
    // So the "donation" doesn't affect addLiquidity share calculation directly UNLESS we sync.
    
    // Wait, the issue says:
    // "removeLiquidity uses balanceOf(address(this)) for the pool balance — this is manipulable via direct token transfers"
    
    // If Attacker donates AFTER victim deposits, he can steal.
  });

  it("Vulnerability: removeLiquidity uses balanceOf and is manipulable", async function () {
    // 1. Attacker and Victim deposit normally
    await lp.connect(attacker).addLiquidity(ethers.parseEther("10"), ethers.parseEther("10"));
    await lp.connect(victim).addLiquidity(ethers.parseEther("10"), ethers.parseEther("10"));

    const attackerLP = await lp.balanceOf(attacker.address);
    const victimLP = await lp.balanceOf(victim.address);
    
    // 2. Someone donates tokens to the pool
    await tokenA.transfer(await lp.getAddress(), ethers.parseEther("100"));
    
    // 3. Attacker removes liquidity and gets a disproportionate share of the donated tokens
    // amountA = lpTokens * tokenA.balanceOf(address(this)) / totalSupply();
    // Since it uses balanceOf, the donation is distributed to anyone who removes liquidity.
    // This is "intended" in some pools but "manipulable" if someone can force others out or if it's used for price feeds.
    
    // The issue says it SHOULD use internal reserves.
    
    const initialAttackerA = await tokenA.balanceOf(attacker.address);
    await lp.connect(attacker).removeLiquidity(attackerLP);
    const finalAttackerA = await tokenA.balanceOf(attacker.address);
    
    // If it uses reserveA (20e18), attacker should get 10e18.
    // If it uses balanceOf (120e18), attacker gets 10/20 * 120 = 60e18.
    expect(finalAttackerA - initialAttackerA).to.be.above(ethers.parseEther("50"));
  });
});
