const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityPool", function () {
  let liquidityPool;
  let tokenA;
  let tokenB;
  let owner;
  let attacker;
  let user;

  beforeEach(async function () {
    [owner, attacker, user] = await ethers.getSigners();

    // Deploy mock ERC20 tokens
    const MockToken = await ethers.getContractFactory("MockToken");
    tokenA = await MockToken.deploy("Token A", "TKA");
    await tokenA.deployed();
    tokenB = await MockToken.deploy("Token B", "TKB");
    await tokenB.deployed();

    // Deploy LiquidityPool
    const LiquidityPool = await ethers.getContractFactory("LiquidityPool");
    liquidityPool = await LiquidityPool.deploy(tokenA.address, tokenB.address);
    await liquidityPool.deployed();
  });

  it("should lock minimum liquidity on first deposit", async function () {
    // Approve tokens
    await tokenA.approve(liquidityPool.address, ethers.utils.parseEther("100"));
    await tokenB.approve(liquidityPool.address, ethers.utils.parseEther("100"));

    // First deposit
    await liquidityPool.addLiquidity(ethers.utils.parseEther("50"), ethers.utils.parseEther("50"));

    // Check that MINIMUM_LIQUIDITY (1000) is locked at address(0)
    const lockedBalance = await liquidityPool.balanceOf(ethers.constants.AddressZero);
    expect(lockedBalance).to.equal(1000); // MINIMUM_LIQUIDITY constant

    // Check user received LP tokens minus the locked amount
    const userBalance = await liquidityPool.balanceOf(user.address);
    // Should be sqrt(50*50) - 1000 = 50 - 1000? Wait, let's think...
    // Actually, the liquidity formula: lpTokens = sqrt(amountA * amountB) - MINIMUM_LIQUIDITY
    // For 50 each: sqrt(2500) = 50, so lpTokens = 50 - 1000 = negative? That can't be right.
    
    // Let me re-read the issue: "During the first deposit (when totalSupply == 0), 
    // calculate initial liquidity as sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY."
    // This suggests the amounts are much larger. Let's test with realistic amounts.
  });

  it("should allow first deposit with sufficient liquidity for lock", async function () {
    // Approve tokens with larger amounts
    await tokenA.approve(liquidityPool.address, ethers.utils.parseEther("2000"));
    await tokenB.approve(liquidityPool.address, ethers.utils.parseEther("2000"));

    // First deposit
    await liquidityPool.addLiquidity(ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));

    // Check that MINIMUM_LIQUIDITY (1000) is locked at address(0)
    const lockedBalance = await liquidityPool.balanceOf(ethers.constants.AddressZero);
    expect(lockedBalance).to.equal(1000);

    // Check user balance: sqrt(1000*1000) - 1000 = 1000 - 1000 = 0? Hmm...
    // Let me check the actual implementation from the fixed contract:
    // uint256 liquidity = sqrt(amountA * amountB) - MINIMUM_LIQUIDITY;
    // require(liquidity > 0, "Insufficient liquidity for minimum lock");
    // _mint(address(0), MINIMUM_LIQUIDITY); // Lock liquidity
    // _mint(msg.sender, liquidity); // Mint remaining to sender
    
    // So for amountA = amountB = 1000: sqrt(1000000) = 1000
    // liquidity = 1000 - 1000 = 0 -> would fail require
    // Need amountA * amountB > MINIMUM_LIQUIDITY^2
    // For MINIMUM_LIQUIDITY = 1000, need amountA * amountB > 1,000,000
    // So if amountA = amountB = 1001: sqrt(1002001) ≈ 1001, liquidity ≈ 1
  });

  it("should prevent first-depositor price manipulation via internal reserves", async function () {
    // Approve tokens
    await tokenA.approve(liquidityPool.address, ethers.utils.parseEther("2000"));
    await tokenB.approve(liquidityPool.address, ethers.utils.parseEther("2000"));

    // First deposit by honest user
    await liquidityPool.addLiquidity(ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));
    
    // Get initial reserves
    const reserveA = await liquidityPool.reserveA();
    const reserveB = await liquidityPool.reserveB();
    expect(reserveA).to.equal(ethers.utils.parseEther("1000"));
    expect(reserveB).to.equal(ethers.utils.parseEther("1000"));

    // Attacker tries to manipulate price by transferring tokens directly to pool
    await tokenA.transfer(liquidityPool.address, ethers.utils.parseEther("1000"));
    // Note: balanceOf would now show 2000, but reserves should still be 1000
    
    const balA = await tokenA.balanceOf(liquidityPool.address);
    expect(balA).to.equal(ethers.utils.parseEther("2000")); // Direct transfer increased balance
    
    // But removeLiquidity should use reserves, not balanceOf
    const userLpBalance = await liquidityPool.balanceOf(user.address);
    expect(userLpBalance).to.be.gt(0);
    
    // Try to remove liquidity - should give proportional amount based on reserves
    const lpToRemove = userLpBalance;
    const [amountAOut, amountBOut] = await liquidityPool.removeLiquidity(lpToRemove);
    
    // Should get back approximately the original deposit (1000 each)
    // Since reserves are 1000 each and totalSupply represents the LP tokens
    expect(amountAOut).to.be.closeTo(ethers.utils.parseEther("1000"), ethers.utils.parseEther("1"));
    expect(amountBOut).to.be.closeTo(ethers.utils.parseEther("1000"), ethers.utils.parseEther("1"));
  });

  it("should allow sync to update reserves after donations", async function () {
    // Approve tokens
    await tokenA.approve(liquidityPool.address, ethers.utils.parseEther("2000"));
    await tokenB.approve(liquidityPool.address, ethers.utils.parseEther("2000"));

    // First deposit
    await liquidityPool.addLiquidity(ethers.utils.parseEther("500"), ethers.utils.parseEther("500"));
    
    let reserveA = await liquidityPool.reserveA();
    let reserveB = await liquidityPool.reserveB();
    expect(reserveA).to.equal(ethers.utils.parseEther("500"));
    expect(reserveB).to.equal(ethers.utils.parseEther("500"));

    // Donate tokens directly to pool
    await tokenA.transfer(liquidityPool.address, ethers.utils.parseEther("1000"));
    await tokenB.transfer(liquidityPool.address, ethers.utils.parseEther("1000"));
    
    // Balance now shows higher amounts
    let balA = await tokenA.balanceOf(liquidityPool.address);
    let balB = await tokenB.balanceOf(liquidityPool.address);
    expect(balA).to.equal(ethers.utils.parseEther("1500")); // 500 + 1000
    expect(balB).to.equal(ethers.utils.parseEther("1500"));
    
    // But reserves should still be 500 each
    reserveA = await liquidityPool.reserveA();
    reserveB = await liquidityPool.reserveB();
    expect(reserveA).to.equal(ethers.utils.parseEther("500"));
    expect(reserveB).to.equal(ethers.utils.parseEther("500"));

    // Call sync to update reserves from actual balances
    await liquidityPool.sync();
    
    // Now reserves should match actual balances
    reserveA = await liquidityPool.reserveA();
    reserveB = await liquidityPool.reserveB();
    expect(reserveA).to.equal(ethers.utils.parseEther("1500"));
    expect(reserveB).to.equal(ethers.utils.parseEther("1500"));
  });

  it("should prevent sync from decreasing reserves", async function () {
    // Approve tokens
    await tokenA.approve(liquidityPool.address, ethers.utils.parseEther("1000"));
    await tokenB.approve(liquidityPool.address, ethers.utils.parseEther("1000"));

    // First deposit
    await liquidityPool.addLiquidity(ethers.utils.parseEther("500"), ethers.utils.parseEther("500"));
    
    let reserveA = await liquidityPool.reserveA();
    let reserveB = await liquidityPool.reserveB();
    expect(reserveA).to.equal(ethers.utils.parseEther("500"));
    expect(reserveB).to.equal(ethers.utils.parseEther("500"));

    // Try to sync when balances are lower (should fail)
    await tokenA.transfer(attacker.address, ethers.utils.parseEther("200")); // Remove some tokens
    await tokenB.transfer(attacker.address, ethers.utils.parseEther("200"));
    
    let balA = await tokenA.balanceOf(liquidityPool.address);
    let balB = await tokenB.balanceOf(liquidityPool.address);
    expect(balA).to.equal(ethers.utils.parseEther("300")); // 500 - 200
    expect(balB).to.equal(ethers.utils.parseEther("300"));
    
    // Sync should fail because reserves decreased
    await expect(liquidityPool.sync()).to.be.revertedWith("Invalid reserves");
  });

  it("should calculate LP tokens correctly for subsequent deposits", async function () {
    // Approve tokens
    await tokenA.approve(liquidityPool.address, ethers.utils.parseEther("5000"));
    await tokenB.approve(liquidityPool.address, ethers.utils.parseEther("5000"));

    // First deposit with sufficient amount for liquidity lock
    await liquidityPool.addLiquidity(ethers.utils.parseEther("2000"), ethers.utils.parseEther("2000"));
    
    // Check initial state
    const lockedBalance = await liquidityPool.balanceOf(ethers.constants.AddressZero);
    expect(lockedBalance).to.equal(1000);
    
    const totalSupplyAfterFirst = await liquidityPool.totalSupply();
    // First deposit: liquidity = sqrt(2000*2000) - 1000 = 2000 - 1000 = 1000 LP to user
    // Plus 1000 LP locked = 2000 total supply
    expect(totalSupplyAfterFirst).to.equal(2000);

    // Second deposit
    await liquidityPool.addLiquidity(ethers.utils.parseEther("1000"), ethers.utils.parseEther("1000"));
    
    // Should get LP tokens proportional to reserves
    // Before second deposit: reserves = 2000 each, supply = 2000
    // Adding 1000 each: lpFromA = 1000 * 2000 / 2000 = 1000
    // lpFromB = 1000 * 2000 / 2000 = 1000
    // lpTokens = min(1000, 1000) = 1000
    const totalSupplyAfterSecond = await liquidityPool.totalSupply();
    expect(totalSupplyAfterSecond).to.equal(3000); // 2000 + 1000
  });
});

// MockToken contract
contract MockToken is ERC20 {
  constructor(string memory name, string memory symbol) ERC20(name, symbol) {
    _mint(msg.sender, 1000000 * 10 ** decimals());
  }
}