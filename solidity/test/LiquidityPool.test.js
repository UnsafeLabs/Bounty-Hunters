const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityPool", function () {
  let tokenA, tokenB, pool;
  let owner, user, attacker;

  const MINIMUM_LIQUIDITY = 1000;

  beforeEach(async function () {
    [owner, user, attacker] = await ethers.getSigners();

    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    tokenA = await ERC20Mock.deploy("TokenA", "TKA");
    tokenB = await ERC20Mock.deploy("TokenB", "TKB");

    const LiquidityPool = await ethers.getContractFactory("LiquidityPool");
    pool = await LiquidityPool.deploy(await tokenA.getAddress(), await tokenB.getAddress());

    await tokenA.mint(owner.address, ethers.parseEther("1000000"));
    await tokenB.mint(owner.address, ethers.parseEther("1000000"));
    await tokenA.mint(user.address, ethers.parseEther("1000000"));
    await tokenB.mint(user.address, ethers.parseEther("1000000"));
    await tokenA.mint(attacker.address, ethers.parseEther("1000000"));
    await tokenB.mint(attacker.address, ethers.parseEther("1000000"));

    // Approve pool for all
    await tokenA.connect(owner).approve(await pool.getAddress(), ethers.MaxUint256);
    await tokenB.connect(owner).approve(await pool.getAddress(), ethers.MaxUint256);
    await tokenA.connect(user).approve(await pool.getAddress(), ethers.MaxUint256);
    await tokenB.connect(user).approve(await pool.getAddress(), ethers.MaxUint256);
    await tokenA.connect(attacker).approve(await pool.getAddress(), ethers.MaxUint256);
    await tokenB.connect(attacker).approve(await pool.getAddress(), ethers.MaxUint256);
  });

  describe("First deposit", function () {
    it("should lock MINIMUM_LIQUIDITY tokens at address(0)", async function () {
      await pool.connect(owner).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
      expect(await pool.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(MINIMUM_LIQUIDITY);
    });

    it("should give first depositor LP tokens minus the locked amount", async function () {
      const tx = await pool.connect(owner).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
      const expectedLp = ethers.parseEther("100") - BigInt(MINIMUM_LIQUIDITY);
      expect(await pool.balanceOf(owner.address)).to.equal(expectedLp);
    });

    it("should revert if initial deposit is too small", async function () {
      await expect(
        pool.connect(owner).addLiquidity(1, 1)
      ).to.be.revertedWith("Insufficient initial liquidity");
    });
  });

  describe("Subsequent deposits", function () {
    beforeEach(async function () {
      await pool.connect(owner).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
    });

    it("should mint LP tokens proportional to deposit share", async function () {
      const totalSupplyBefore = await pool.totalSupply();
      await pool.connect(user).addLiquidity(ethers.parseEther("50"), ethers.parseEther("50"));
      const expectedLp = ethers.parseEther("50") * totalSupplyBefore / ethers.parseEther("100");
      expect(await pool.balanceOf(user.address)).to.be.closeTo(expectedLp, 2n);
    });

    it("should update reserves correctly", async function () {
      await pool.connect(user).addLiquidity(ethers.parseEther("50"), ethers.parseEther("50"));
      expect(await pool.reserveA()).to.equal(ethers.parseEther("150"));
      expect(await pool.reserveB()).to.equal(ethers.parseEther("150"));
    });
  });

  describe("removeLiquidity", function () {
    beforeEach(async function () {
      await pool.connect(owner).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
    });

    it("should return correct amounts based on internal reserves", async function () {
      const lpBalance = await pool.balanceOf(owner.address);
      const totalSupply = await pool.totalSupply();
      const expectedA = lpBalance * ethers.parseEther("100") / totalSupply;
      const expectedB = lpBalance * ethers.parseEther("100") / totalSupply;

      const tx = await pool.connect(owner).removeLiquidity(lpBalance);
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log) => pool.interface.parseLog({ topics: log.topics, data: log.data })?.name === "LiquidityRemoved"
      );
      const parsed = pool.interface.parseLog({ topics: event.topics, data: event.data });
      expect(parsed.args.amountA).to.be.closeTo(expectedA, 2n);
      expect(parsed.args.amountB).to.be.closeTo(expectedB, 2n);
    });

    it("should not be affected by direct token transfers to pool", async function () {
      const lpBalance = await pool.balanceOf(owner.address);
      const totalSupply = await pool.totalSupply();
      const expectedA = lpBalance * ethers.parseEther("100") / totalSupply;
      const expectedB = lpBalance * ethers.parseEther("100") / totalSupply;

      // Donate tokens directly to pool — should not affect removeLiquidity
      await tokenA.connect(attacker).transfer(await pool.getAddress(), ethers.parseEther("1000"));

      const tx = await pool.connect(owner).removeLiquidity(lpBalance);
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log) => pool.interface.parseLog({ topics: log.topics, data: log.data })?.name === "LiquidityRemoved"
      );
      const parsed = pool.interface.parseLog({ topics: event.topics, data: event.data });
      // Should match expected amounts based on internal reserves, not inflated balanceOf
      expect(parsed.args.amountA).to.be.closeTo(expectedA, 2n);
      expect(parsed.args.amountB).to.be.closeTo(expectedB, 2n);
    });
  });

  describe("Price manipulation protection", function () {
    it("should prevent first-depositor price manipulation", async function () {
      // Attacker tries: tiny first deposit, then large transfer to inflate price
      await pool.connect(attacker).addLiquidity(ethers.parseEther("0.001"), ethers.parseEther("0.001"));

      // sqrt(1e15 * 1e15) = 1e15, minus MINIMUM_LIQUIDITY
      const expectedLp = ethers.parseUnits("1", 15) - BigInt(MINIMUM_LIQUIDITY);
      const attackerLp = await pool.balanceOf(attacker.address);
      expect(attackerLp).to.equal(expectedLp);

      // Donate large amount to make LP look more valuable
      await tokenA.connect(attacker).transfer(await pool.getAddress(), ethers.parseEther("10000"));

      // Now remove liquidity — should only get internal reserve share
      const totalSupply = await pool.totalSupply();
      const expectedA = attackerLp * (await pool.reserveA()) / totalSupply;
      const expectedB = attackerLp * (await pool.reserveB()) / totalSupply;

      const tx = await pool.connect(attacker).removeLiquidity(attackerLp);
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log) => pool.interface.parseLog({ topics: log.topics, data: log.data })?.name === "LiquidityRemoved"
      );
      const parsed = pool.interface.parseLog({ topics: event.topics, data: event.data });
      expect(parsed.args.amountA).to.be.closeTo(expectedA, 2n);
      expect(parsed.args.amountB).to.be.closeTo(expectedB, 2n);
    });
  });

  describe("sync", function () {
    it("should update reserves to match actual balances", async function () {
      await pool.connect(owner).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
      await tokenA.connect(attacker).transfer(await pool.getAddress(), ethers.parseEther("50"));

      const reserveABefore = await pool.reserveA();
      expect(reserveABefore).to.equal(ethers.parseEther("100"));

      await pool.sync();
      expect(await pool.reserveA()).to.equal(ethers.parseEther("150"));
    });

    it("should emit Sync event", async function () {
      await pool.connect(owner).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"));
      await expect(pool.sync())
        .to.emit(pool, "Sync")
        .withArgs(ethers.parseEther("100"), ethers.parseEther("100"));
    });
  });
});
