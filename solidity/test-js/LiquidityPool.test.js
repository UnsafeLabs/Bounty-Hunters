const { expect } = require("chai");

const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

async function deployFixture() {
  const { ethers } = await import("ethers");
  const hre = require("hardhat");
  const [alice, bob, attacker] = await hre.ethers.getSigners();

  const MockToken = await hre.ethers.getContractFactory("MockToken");
  const tokenA = await MockToken.deploy("Token A", "TKA");
  const tokenB = await MockToken.deploy("Token B", "TKB");

  const LiquidityPool = await hre.ethers.getContractFactory("LiquidityPool");
  const pool = await LiquidityPool.deploy(
    await tokenA.getAddress(),
    await tokenB.getAddress()
  );

  for (const user of [alice, bob, attacker]) {
    await tokenA.mint(user.address, ethers.parseEther("1000000"));
    await tokenB.mint(user.address, ethers.parseEther("1000000"));
  }

  return { pool, tokenA, tokenB, alice, bob, attacker, ethers, hre };
}

describe("LiquidityPool", function () {
  const MINIMUM_LIQUIDITY = 1000n;
  const AMOUNT = BigInt("10000000000000000000000"); // 10000 ether

  beforeEach(async function () {
    const fixture = await deployFixture();
    Object.assign(this, fixture);
  });

  describe("First deposit", function () {
    it("should lock MINIMUM_LIQUIDITY at dead address", async function () {
      await this.tokenA.connect(this.alice).approve(await this.pool.getAddress(), AMOUNT);
      await this.tokenB.connect(this.alice).approve(await this.pool.getAddress(), AMOUNT);
      await this.pool.connect(this.alice).addLiquidity(AMOUNT, AMOUNT);
      const bal = await this.pool.balanceOf(DEAD_ADDRESS);
      expect(bal).to.equal(MINIMUM_LIQUIDITY);
    });

    it("should give first depositor lpTokens - MINIMUM_LIQUIDITY", async function () {
      await this.tokenA.connect(this.alice).approve(await this.pool.getAddress(), AMOUNT);
      await this.tokenB.connect(this.alice).approve(await this.pool.getAddress(), AMOUNT);
      await this.pool.connect(this.alice).addLiquidity(AMOUNT, AMOUNT);
      const aliceBalance = await this.pool.balanceOf(this.alice.address);
      expect(aliceBalance).to.equal(AMOUNT - MINIMUM_LIQUIDITY);
    });

    it("should revert if initial liquidity is too small", async function () {
      const tiny = 100n;
      await this.tokenA.connect(this.alice).approve(await this.pool.getAddress(), tiny);
      await this.tokenB.connect(this.alice).approve(await this.pool.getAddress(), tiny);
      try {
        await this.pool.connect(this.alice).addLiquidity(tiny, tiny);
        expect.fail("Should have reverted");
      } catch (e) {
        expect(e.message).to.include("Insufficient initial liquidity");
      }
    });

    it("should set reserves correctly", async function () {
      await this.tokenA.connect(this.alice).approve(await this.pool.getAddress(), AMOUNT);
      await this.tokenB.connect(this.alice).approve(await this.pool.getAddress(), AMOUNT);
      await this.pool.connect(this.alice).addLiquidity(AMOUNT, AMOUNT);
      expect(await this.pool.reserveA()).to.equal(AMOUNT);
      expect(await this.pool.reserveB()).to.equal(AMOUNT);
    });
  });

  describe("Subsequent deposits", function () {
    it("should mint proportional LP tokens", async function () {
      await this.tokenA.connect(this.alice).approve(await this.pool.getAddress(), AMOUNT);
      await this.tokenB.connect(this.alice).approve(await this.pool.getAddress(), AMOUNT);
      await this.pool.connect(this.alice).addLiquidity(AMOUNT, AMOUNT);

      const half = AMOUNT / 2n;
      await this.tokenA.connect(this.bob).approve(await this.pool.getAddress(), half);
      await this.tokenB.connect(this.bob).approve(await this.pool.getAddress(), half);
      await this.pool.connect(this.bob).addLiquidity(half, half);
      expect(await this.pool.balanceOf(this.bob.address)).to.be.gt(0n);
      expect(await this.pool.reserveA()).to.equal(AMOUNT + half);
    });
  });

  describe("Donation attack prevention", function () {
    it("should use internal reserves not balanceOf for removal", async function () {
      await this.tokenA.connect(this.alice).approve(await this.pool.getAddress(), AMOUNT);
      await this.tokenB.connect(this.alice).approve(await this.pool.getAddress(), AMOUNT);
      await this.pool.connect(this.alice).addLiquidity(AMOUNT, AMOUNT);
      const aliceLp = await this.pool.balanceOf(this.alice.address);

      // Record pool tokenA balance before donation
      const poolTokenABefore = await this.tokenA.balanceOf(await this.pool.getAddress());

      // Attacker donates 100000 ether of tokenA directly to pool
      const donation = BigInt("100000000000000000000000");
      await this.tokenA.mint(await this.pool.getAddress(), donation);

      // Pool balance is now inflated
      const poolTokenAAfter = await this.tokenA.balanceOf(await this.pool.getAddress());
      expect(poolTokenAAfter).to.equal(poolTokenABefore + donation);

      // Alice removes all her liquidity
      // With the fix: she gets reserve-based amount (AMOUNT - MINIMUM_LIQUIDITY due to rounding)
      // Without fix (using balanceOf): she'd get (AMOUNT + donation) * lp / totalSupply = much more
      const aliceTokenABefore = await this.tokenA.balanceOf(this.alice.address);
      await this.pool.connect(this.alice).removeLiquidity(aliceLp);
      const aliceTokenAAfter = await this.tokenA.balanceOf(this.alice.address);

      const withdrawnA = aliceTokenAAfter - aliceTokenABefore;

      // The withdrawn amount should be approximately AMOUNT (minus MINIMUM_LIQUIDITY due to lock)
      // NOT inflated by the donation
      expect(withdrawnA).to.be.lt(AMOUNT); // Less than deposited (due to MINIMUM_LIQUIDITY lock)
      expect(withdrawnA).to.be.gte(AMOUNT - MINIMUM_LIQUIDITY * 2n); // Within reasonable range

      // The remaining donation should still be in the pool
      const poolTokenARemaining = await this.tokenA.balanceOf(await this.pool.getAddress());
      expect(poolTokenARemaining).to.be.gt(0n);
    });
  });

  describe("sync()", function () {
    it("should update reserves after donation", async function () {
      await this.tokenA.connect(this.alice).approve(await this.pool.getAddress(), AMOUNT);
      await this.tokenB.connect(this.alice).approve(await this.pool.getAddress(), AMOUNT);
      await this.pool.connect(this.alice).addLiquidity(AMOUNT, AMOUNT);

      const donation = BigInt("50000000000000000000000"); // 50000 ether
      await this.tokenA.mint(await this.pool.getAddress(), donation);
      expect(await this.pool.reserveA()).to.equal(AMOUNT);

      await this.pool.sync();
      expect(await this.pool.reserveA()).to.equal(AMOUNT + donation);
    });

    it("should emit Sync event", async function () {
      await this.tokenA.connect(this.alice).approve(await this.pool.getAddress(), AMOUNT);
      await this.tokenB.connect(this.alice).approve(await this.pool.getAddress(), AMOUNT);
      await this.pool.connect(this.alice).addLiquidity(AMOUNT, AMOUNT);

      const donation = BigInt("5000000000000000000000"); // 5000 ether
      await this.tokenA.mint(await this.pool.getAddress(), donation);

      await expect(this.pool.sync())
        .to.emit(this.pool, "Sync")
        .withArgs(AMOUNT + donation, AMOUNT);
    });
  });

  describe("removeLiquidity edge cases", function () {
    it("should revert on zero lpTokens", async function () {
      try {
        await this.pool.connect(this.alice).removeLiquidity(0);
        expect.fail("Should have reverted");
      } catch (e) {
        expect(e.message).to.include("Must burn > 0");
      }
    });

    it("should revert if insufficient LP tokens", async function () {
      try {
        await this.pool.connect(this.alice).removeLiquidity(1);
        expect.fail("Should have reverted");
      } catch (e) {
        expect(e.message).to.include("Insufficient LP tokens");
      }
    });
  });
});
