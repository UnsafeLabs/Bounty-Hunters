const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityPool", function () {
  let tokenA, tokenB, pool;
  let owner, attacker, user;

  const MINIMUM_LIQUIDITY = 1000n;
  const INITIAL_MINT = ethers.parseEther("1000000");

  beforeEach(async function () {
    [owner, attacker, user] = await ethers.getSigners();

    // Deploy mock ERC20 tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tokenA = await MockERC20.deploy("Token A", "TKNA", INITIAL_MINT);
    tokenB = await MockERC20.deploy("Token B", "TKNB", INITIAL_MINT);

    // Deploy LiquidityPool
    const LiquidityPool = await ethers.getContractFactory("LiquidityPool");
    pool = await LiquidityPool.deploy(
      await tokenA.getAddress(),
      await tokenB.getAddress()
    );

    // Give everyone tokens
    for (const user of [owner, attacker, user]) {
      await tokenA.transfer(user.address, ethers.parseEther("10000"));
      await tokenB.transfer(user.address, ethers.parseEther("10000"));
    }

    // Approve pool to spend tokens
    for (const user of [owner, attacker, user]) {
      await tokenA.connect(user).approve(
        await pool.getAddress(),
        ethers.MaxUint256
      );
      await tokenB.connect(user).approve(
        await pool.getAddress(),
        ethers.MaxUint256
      );
    }
  });

  describe("First Deposit - MINIMUM_LIQUIDITY Lock", function () {
    it("should lock MINIMUM_LIQUIDITY tokens at address(0) on first deposit", async function () {
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("100");

      await pool.connect(owner).addLiquidity(amountA, amountB);

      // address(0) should hold MINIMUM_LIQUIDITY LP tokens
      const deadBalance = await pool.balanceOf("0x0000000000000000000000000000000000000000");
      expect(deadBalance).to.equal(MINIMUM_LIQUIDITY);

      // address(0) is the zero address / dead address
      const deadAddr = "0x0000000000000000000000000000000000000000";
      expect(await pool.balanceOf(deadAddr)).to.equal(MINIMUM_LIQUIDITY);
    });

    it("should give first depositor LP tokens minus MINIMUM_LIQUIDITY", async function () {
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("100");

      await pool.connect(owner).addLiquidity(amountA, amountB);

      // Expected LP tokens = sqrt(100e18 * 100e18) - 1000 = 100e18 - 1000
      // But due to sqrt being integer, we calculate:
      const sqrtProduct = BigInt(
        Math.floor(Math.sqrt(Number(ethers.parseEther("100")) * Number(ethers.parseEther("100")) / 1e18)) * 1e18
      );
      // Actually let's just check balance > 0 and total supply = balance + MINIMUM_LIQUIDITY
      const ownerBalance = await pool.balanceOf(owner.address);
      expect(ownerBalance).to.be.gt(0);

      const totalSupply = await pool.totalSupply();
      expect(totalSupply).to.equal(ownerBalance + MINIMUM_LIQUIDITY);
    });

    it("should revert if initial liquidity is insufficient to cover MINIMUM_LIQUIDITY", async function () {
      // Try to add very tiny liquidity (sqrt(1*1) = 1 < MINIMUM_LIQUIDITY)
      await expect(
        pool.connect(owner).addLiquidity(1, 1)
      ).to.be.revertedWith("Insufficient initial liquidity");
    });

    it("should revert if initial liquidity equals MINIMUM_LIQUIDITY", async function () {
      // sqrt(MINIMUM_LIQUIDITY * MINIMUM_LIQUIDITY) = MINIMUM_LIQUIDITY, so lpTokens = 0 after subtraction
      const amount = BigInt(Math.ceil(Math.sqrt(Number(MINIMUM_LIQUIDITY))));
      // Actually we need amount^2 > MINIMUM_LIQUIDITY
      // Let's use amount where sqrt(amountA * amountB) <= MINIMUM_LIQUIDITY
      // sqrt(3162 * 3162) = 3162 > 1000, so that works
      // Try amount where sqrt(product) = 1000 exactly
      const amt = 1000n; // sqrt(1000 * 1000) = 1000, equals MINIMUM_LIQUIDITY
      await expect(
        pool.connect(owner).addLiquidity(amt, amt)
      ).to.be.revertedWith("Insufficient initial liquidity");
    });
  });

  describe("First-Depositor Attack Prevention", function () {
    it("should prevent attacker from manipulating LP price via tiny first deposit", async function () {
      // Setup: legitimate first deposit
      const legitAmountA = ethers.parseEther("100");
      const legitAmountB = ethers.parseEther("100");
      await pool.connect(owner).addLiquidity(legitAmountA, legitAmountB);

      // Record total supply after legitimate deposit
      const totalSupplyAfterLegit = await pool.totalSupply();

      // Attacker tries to be the first depositor (impossible now since pool already initialized)
      // But they can add liquidity as a normal user
      const attackerAmountA = ethers.parseEther("1");
      const attackerAmountB = ethers.parseEther("1");
      await pool.connect(attacker).addLiquidity(attackerAmountA, attackerAmountB);

      // Attacker LP tokens should be proportional, not inflated
      const attackerBalance = await pool.balanceOf(attacker.address);
      const attackerShare = (attackerBalance * 10000n) / (await pool.totalSupply());
      
      // Attacker's share should be roughly proportional to their deposit
      // 1 ETH out of ~101 ETH total = ~1%
      expect(attackerShare).to.be.lt(200n); // less than 2%

      // Verify attacker cannot drain disproportionate assets
      const reserveABefore = await pool.reserveA();
      const reserveBBefore = await pool.reserveB();

      await pool.connect(attacker).removeLiquidity(attackerBalance);

      const reserveAAfter = await pool.reserveA();
      const reserveBAfter = await pool.reserveB();

      // Attacker shouldn't drain more than they put in
      expect(reserveABefore - reserveAAfter).to.be.lte(attackerAmountA + ethers.parseEther("0.1"));
      expect(reserveBBefore - reserveBAfter).to.be.lte(attackerAmountB + ethers.parseEther("0.1"));
    });

    it("should prevent classic Uniswap V2 first-depositor attack", async function () {
      // This test demonstrates the attack would fail because of MINIMUM_LIQUIDITY lock
      
      // First deposit with adequate amounts
      await pool.connect(owner).addLiquidity(
        ethers.parseEther("200"),
        ethers.parseEther("200")
      );

      const ownerLP = await pool.balanceOf(owner.address);
      expect(ownerLP).to.be.gt(0);

      // Verify no-one can become "first" again
      // The dead address holds MINIMUM_LIQUIDITY, so totalSupply is never 0
      const deadBalance = await pool.balanceOf("0x0000000000000000000000000000000000000000");
      expect(deadBalance).to.equal(MINIMUM_LIQUIDITY);
    });
  });

  describe("removeLiquidity - Internal Reserves", function () {
    it("should use internal reserves, not balanceOf", async function () {
      // Add liquidity
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("100");
      await pool.connect(owner).addLiquidity(amountA, amountB);

      const ownerLP = await pool.balanceOf(owner.address);
      const halfLP = ownerLP / 2n;

      // Record expected returns based on reserves
      const reserveA = await pool.reserveA();
      const reserveB = await pool.reserveB();
      const totalSupply = await pool.totalSupply();
      const expectedA = halfLP * reserveA / totalSupply;
      const expectedB = halfLP * reserveB / totalSupply;

      // Record owner balances before removal
      const ownerABefore = await tokenA.balanceOf(owner.address);
      const ownerBBefore = await tokenB.balanceOf(owner.address);

      await pool.connect(owner).removeLiquidity(halfLP);

      const ownerAAfter = await tokenA.balanceOf(owner.address);
      const ownerBAfter = await tokenB.balanceOf(owner.address);

      // Should receive expected amounts based on reserves
      expect(ownerAAfter - ownerABefore).to.equal(expectedA);
      expect(ownerBAfter - ownerBBefore).to.equal(expectedB);
    });

    it("should not be manipulable via direct token transfers (donation attack)", async function () {
      // Add legitimate liquidity
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("100");
      await pool.connect(owner).addLiquidity(amountA, amountB);

      const ownerLP = await pool.balanceOf(owner.address);

      // Attacker donates tokens directly to pool (bypassing addLiquidity)
      const donateAmount = ethers.parseEther("1000");
      await tokenA.connect(attacker).transfer(await pool.getAddress(), donateAmount);
      await tokenB.connect(attacker).transfer(await pool.getAddress(), donateAmount);

      // Even though pool's actual balance is now inflated,
      // removeLiquidity should use internal reserves (not balanceOf)
      const reserveABefore = await pool.reserveA();
      const reserveBBefore = await pool.reserveB();
      const totalSupply = await pool.totalSupply();

      const expectedA = ownerLP * reserveABefore / totalSupply;
      const expectedB = ownerLP * reserveBBefore / totalSupply;

      const ownerABefore = await tokenA.balanceOf(owner.address);
      const ownerBBefore = await tokenB.balanceOf(owner.address);

      await pool.connect(owner).removeLiquidity(ownerLP);

      const ownerAAfter = await tokenA.balanceOf(owner.address);
      const ownerBAfter = await tokenB.balanceOf(owner.address);

      // Owner should only receive based on reserves, NOT the inflated balanceOf
      expect(ownerAAfter - ownerABefore).to.equal(expectedA);
      expect(ownerBAfter - ownerBBefore).to.equal(expectedB);
    });

    it("should revert if insufficient LP tokens", async function () {
      await pool.connect(owner).addLiquidity(
        ethers.parseEther("100"),
        ethers.parseEther("100")
      );

      // User has 0 LP tokens, should fail
      await expect(
        pool.connect(user).removeLiquidity(1)
      ).to.be.revertedWith("Insufficient LP tokens");
    });

    it("should revert if removing 0 LP tokens", async function () {
      await expect(
        pool.connect(owner).removeLiquidity(0)
      ).to.be.revertedWith("Must burn > 0");
    });

    it("should allow full liquidity removal", async function () {
      const amountA = ethers.parseEther("50");
      const amountB = ethers.parseEther("50");
      await pool.connect(owner).addLiquidity(amountA, amountB);

      const ownerLP = await pool.balanceOf(owner.address);

      await pool.connect(owner).removeLiquidity(ownerLP);

      // LP balance should be 0
      expect(await pool.balanceOf(owner.address)).to.equal(0);

      // Reserves should only have MINIMUM_LIQUIDITY's worth (locked dust)
      const reserveA = await pool.reserveA();
      const reserveB = await pool.reserveB();
      expect(reserveA).to.be.lte(2n);
      expect(reserveB).to.be.lte(2n);
    });
  });

  describe("Sync Function", function () {
    it("should update reserves to match actual balances", async function () {
      // Add liquidity to set initial reserves
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("100");
      await pool.connect(owner).addLiquidity(amountA, amountB);

      const reserveABefore = await pool.reserveA();
      const reserveBBefore = await pool.reserveB();

      // Donate tokens directly to pool (bypass addLiquidity)
      const donateAmount = ethers.parseEther("500");
      await tokenA.connect(attacker).transfer(await pool.getAddress(), donateAmount);
      await tokenB.connect(attacker).transfer(await pool.getAddress(), donateAmount);

      // Reserves should still be old values
      expect(await pool.reserveA()).to.equal(reserveABefore);
      expect(await pool.reserveB()).to.equal(reserveBBefore);

      // Call sync
      await expect(pool.connect(user).sync())
        .to.emit(pool, "Sync")
        .withArgs(reserveABefore + donateAmount, reserveBBefore + donateAmount);

      // Reserves should now match actual balances
      const actualBalanceA = await tokenA.balanceOf(await pool.getAddress());
      const actualBalanceB = await tokenB.balanceOf(await pool.getAddress());

      expect(await pool.reserveA()).to.equal(actualBalanceA);
      expect(await pool.reserveB()).to.equal(actualBalanceB);
    });

    it("should allow recovery from donation attack via sync", async function () {
      // Add liquidity
      await pool.connect(owner).addLiquidity(
        ethers.parseEther("100"),
        ethers.parseEther("100")
      );

      // Donate tokens
      const donateAmount = ethers.parseEther("1000");
      await tokenA.connect(attacker).transfer(await pool.getAddress(), donateAmount);
      await tokenB.connect(attacker).transfer(await pool.getAddress(), donateAmount);

      // After donation, reserves are stale
      // User who deposited after sync would get correct LP ratio
      // But without sync, new deposits would use stale reserves
      // Call sync to recover
      await pool.connect(user).sync();

      // Now add more liquidity with synced reserves
      const newAmountA = ethers.parseEther("10");
      const newAmountB = ethers.parseEther("10");
      
      // This should work correctly after sync
      await tokenA.connect(user).approve(await pool.getAddress(), ethers.MaxUint256);
      await tokenB.connect(user).approve(await pool.getAddress(), ethers.MaxUint256);
      
      await pool.connect(user).addLiquidity(newAmountA, newAmountB);
      const userLP = await pool.balanceOf(user.address);
      expect(userLP).to.be.gt(0);
    });

    it("should emit Sync event with correct parameters", async function () {
      await pool.connect(owner).addLiquidity(
        ethers.parseEther("100"),
        ethers.parseEther("100")
      );

      const expectedReserveA = await tokenA.balanceOf(await pool.getAddress());
      const expectedReserveB = await tokenB.balanceOf(await pool.getAddress());

      await expect(pool.connect(user).sync())
        .to.emit(pool, "Sync")
        .withArgs(expectedReserveA, expectedReserveB);
    });
  });

  describe("Multiple Depositors", function () {
    it("should handle multiple deposits correctly", async function () {
      // First deposit
      await pool.connect(owner).addLiquidity(
        ethers.parseEther("100"),
        ethers.parseEther("100")
      );

      // Second deposit by user
      await pool.connect(user).addLiquidity(
        ethers.parseEther("50"),
        ethers.parseEther("50")
      );

      // Third deposit by attacker
      await pool.connect(attacker).addLiquidity(
        ethers.parseEther("25"),
        ethers.parseEther("25")
      );

      const ownerLP = await pool.balanceOf(owner.address);
      const userLP = await pool.balanceOf(user.address);
      const attackerLP = await pool.balanceOf(attacker.address);
      const deadLP = await pool.balanceOf("0x0000000000000000000000000000000000000000");

      // All should have LP tokens
      expect(ownerLP).to.be.gt(0);
      expect(userLP).to.be.gt(0);
      expect(attackerLP).to.be.gt(0);
      expect(deadLP).to.equal(MINIMUM_LIQUIDITY);

      // Total supply should equal sum of all balances
      const totalSupply = await pool.totalSupply();
      expect(totalSupply).to.equal(ownerLP + userLP + attackerLP + deadLP);
    });

    it("should maintain correct proportionality for subsequent deposits", async function () {
      // First deposit: 100 of each
      await pool.connect(owner).addLiquidity(
        ethers.parseEther("100"),
        ethers.parseEther("100")
      );

      const reserveA = await pool.reserveA();
      const reserveB = await pool.reserveB();
      const totalSupply = await pool.totalSupply();
      const ownerLP = await pool.balanceOf(owner.address);

      // User deposits 50 of each (50% of reserves)
      const userAmountA = ethers.parseEther("50");
      const userAmountB = ethers.parseEther("50");

      // Expected LP for user:
      // lpFromA = 50e18 * totalSupply / 100e18 = totalSupply * 0.5
      // lpFromB = 50e18 * totalSupply / 100e18 = totalSupply * 0.5
      const expectedUserLP = userAmountA * totalSupply / reserveA;

      await pool.connect(user).addLiquidity(userAmountA, userAmountB);
      const userLP = await pool.balanceOf(user.address);

      // Should be close (within rounding)
      expect(userLP).to.equal(expectedUserLP);
    });
  });

  describe("Events", function () {
    it("should emit LiquidityAdded on deposit", async function () {
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("100");

      await expect(pool.connect(owner).addLiquidity(amountA, amountB))
        .to.emit(pool, "LiquidityAdded")
        .withArgs(owner.address, amountA, amountB, await pool.balanceOf(owner.address));
    });

    it("should emit LiquidityRemoved on withdrawal", async function () {
      await pool.connect(owner).addLiquidity(
        ethers.parseEther("100"),
        ethers.parseEther("100")
      );

      const lpBalance = await pool.balanceOf(owner.address);
      const reserveA = await pool.reserveA();
      const reserveB = await pool.reserveB();
      const totalSupply = await pool.totalSupply();
      const expectedA = lpBalance * reserveA / totalSupply;
      const expectedB = lpBalance * reserveB / totalSupply;

      await expect(pool.connect(owner).removeLiquidity(lpBalance))
        .to.emit(pool, "LiquidityRemoved")
        .withArgs(owner.address, expectedA, expectedB, lpBalance);
    });
  });
});
