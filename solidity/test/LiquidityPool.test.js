const { expect } = require("chai");
const { ethers } = require("hardhat");

// Deploy a simple ERC20 mock for testing the pool
async function deployToken(name, symbol, decimals = 18) {
    const factory = await ethers.getContractFactory("MockERC20");
    const token = await factory.deploy(name, symbol, ethers.parseEther("1000000"));
    await token.waitForDeployment();
    return token;
}

describe("LiquidityPool", function () {
    let pool, tokenA, tokenB, owner, alice, attacker;

    beforeEach(async function () {
        [owner, alice, attacker] = await ethers.getSigners();

        tokenA = await deployToken("Token A", "TKA");
        tokenB = await deployToken("Token B", "TKB");

        const LiquidityPool = await ethers.getContractFactory("LiquidityPool");
        pool = await LiquidityPool.deploy(await tokenA.getAddress(), await tokenB.getAddress());
        await pool.waitForDeployment();

        // Fund alice and attacker with tokens
        await tokenA.transfer(alice.address, ethers.parseEther("10000"));
        await tokenB.transfer(alice.address, ethers.parseEther("10000"));
        await tokenA.transfer(attacker.address, ethers.parseEther("10000"));
        await tokenB.transfer(attacker.address, ethers.parseEther("10000"));

        // Approve pool for all test users
        await tokenA.connect(alice).approve(await pool.getAddress(), ethers.MaxUint256);
        await tokenB.connect(alice).approve(await pool.getAddress(), ethers.MaxUint256);
        await tokenA.connect(attacker).approve(await pool.getAddress(), ethers.MaxUint256);
        await tokenB.connect(attacker).approve(await pool.getAddress(), ethers.MaxUint256);
        await tokenA.connect(owner).approve(await pool.getAddress(), ethers.MaxUint256);
        await tokenB.connect(owner).approve(await pool.getAddress(), ethers.MaxUint256);
    });

    describe("First deposit minimum liquidity lock", function () {
        it("should permanently burn MINIMUM_LIQUIDITY on first deposit", async function () {
            const MINIMUM_LIQUIDITY = await pool.MINIMUM_LIQUIDITY();
            const amount = ethers.parseEther("1000");

            // sqrt(1000e18 * 1000e18) = 1000e18
            const expectedInitialLp = ethers.parseEther("1000");

            await pool.connect(alice).addLiquidity(amount, amount);

            // address(0) should have 0 — nothing minted to it
            expect(await pool.balanceOf(ethers.ZeroAddress)).to.equal(0n);

            // Alice should receive initialLp - MINIMUM_LIQUIDITY
            const aliceBalance = await pool.balanceOf(alice.address);
            expect(aliceBalance).to.equal(expectedInitialLp - MINIMUM_LIQUIDITY);

            // Total supply should be initialLp (the MINIMUM_LIQUIDITY was burned, reducing totalSupply back)
            const totalSupply = await pool.totalSupply();
            expect(totalSupply).to.equal(expectedInitialLp - MINIMUM_LIQUIDITY);

            // Verify MINIMUM_LIQUIDITY is permanently removed from circulation
            expect(totalSupply).to.equal(aliceBalance);
        });

        it("should prevent LP price manipulation by first depositor", async function () {
            const MINIMUM_LIQUIDITY = await pool.MINIMUM_LIQUIDITY();

            // Attacker does minimal first deposit (just enough to pass MINIMUM_LIQUIDITY check)
            // sqrt(1001 * 1001) ≈ 1001 > 1000, so it passes
            const tinyAmount = 1001n;
            await pool.connect(attacker).addLiquidity(tinyAmount, tinyAmount);
            const attackerLp = await pool.balanceOf(attacker.address);
            // attackerLp = 1001 - 1000 = 1 wei of LP
            expect(attackerLp).to.equal(1n);

            // Attacker donates large amount to skew the price
            const donateAmount = ethers.parseEther("5000");
            await tokenA.connect(attacker).transfer(await pool.getAddress(), donateAmount);

            // Alice adds liquidity with fair amounts
            const fairAmount = ethers.parseEther("1000");
            await pool.connect(alice).addLiquidity(fairAmount, fairAmount);

            // Alice should get fair LP tokens proportional to her deposit
            const aliceLp = await pool.balanceOf(alice.address);
            expect(aliceLp).to.be.gt(0);

            // Store alice's token balance before removal
            const aliceTokenABefore = await tokenA.balanceOf(alice.address);

            // Alice removes all her liquidity
            await pool.connect(alice).removeLiquidity(aliceLp);

            const aliceTokenAAfter = await tokenA.balanceOf(alice.address);
            const receivedA = aliceTokenAAfter - aliceTokenABefore;

            // Alice should get back approximately what she put in (not inflated by donation)
            // due to using internal reserves instead of balanceOf
            expect(receivedA).to.be.closeTo(fairAmount, ethers.parseEther("10"));
        });
    });

    describe("Remove liquidity uses internal reserves", function () {
        it("should use reserveA/reserveB instead of balanceOf", async function () {
            const amount = ethers.parseEther("1000");

            await pool.connect(alice).addLiquidity(amount, amount);
            const aliceLp = await pool.balanceOf(alice.address);
            const totalSupply = await pool.totalSupply();

            // Get expected amounts based on reserves
            const reserveA = await pool.reserveA();
            const reserveB = await pool.reserveB();
            const expectedA = aliceLp * reserveA / totalSupply;
            const expectedB = aliceLp * reserveB / totalSupply;

            // Donate tokens directly to pool (should NOT affect removal amount)
            const donateAmount = ethers.parseEther("5000");
            await tokenA.connect(attacker).transfer(await pool.getAddress(), donateAmount);

            // Remove — should get original amount, not donate-inflated amount
            const tx = await pool.connect(alice).removeLiquidity(aliceLp);
            const receipt = await tx.wait();

            // Parse LiquidityRemoved event
            const event = receipt.logs.find(
                log => log.fragment?.name === "LiquidityRemoved"
            );
            expect(event).to.not.be.undefined;
            const [, amountARemoved, amountBRemoved] = event.args;

            expect(amountARemoved).to.equal(expectedA);
            expect(amountBRemoved).to.equal(expectedB);

            // Verify alice got exactly her fair share despite the donation
            const aliceBalA = await tokenA.balanceOf(alice.address);
            const aliceBalB = await tokenB.balanceOf(alice.address);
            expect(aliceBalA).to.equal(ethers.parseEther("10000") - amount + amountARemoved);
            expect(aliceBalB).to.equal(ethers.parseEther("10000") - amount + amountBRemoved);
        });

        it("should not be affected by donation attack", async function () {
            const amount = ethers.parseEther("500");

            // Alice adds liquidity
            await pool.connect(alice).addLiquidity(amount, amount);
            const aliceLp = await pool.balanceOf(alice.address);

            // Attacker makes a donation directly to the pool contract
            const donation = ethers.parseEther("5000");
            await tokenA.connect(attacker).transfer(await pool.getAddress(), donation);

            // Alice removes her liquidity — should get her fair share from internal reserves
            const aliceBalBeforeA = await tokenA.balanceOf(alice.address);
            await pool.connect(alice).removeLiquidity(aliceLp);
            const aliceBalAfterA = await tokenA.balanceOf(alice.address);
            const receivedA = aliceBalAfterA - aliceBalBeforeA;

            // Should not include the donation (received should be close to deposited amount)
            expect(receivedA).to.be.lt(amount * 2n);
            expect(receivedA).to.be.closeTo(amount, ethers.parseEther("1"));
        });
    });

    describe("sync function", function () {
        it("should update reserves after direct transfer", async function () {
            const amount = ethers.parseEther("1000");
            await pool.connect(alice).addLiquidity(amount, amount);

            // Donate tokens directly
            const donation = ethers.parseEther("500");
            await tokenA.connect(attacker).transfer(await pool.getAddress(), donation);

            const oldReserveA = await pool.reserveA();
            const oldReserveB = await pool.reserveB();

            // Sync should update reserveA
            await pool.sync();

            const newReserveA = await pool.reserveA();
            const newReserveB = await pool.reserveB();

            expect(newReserveA).to.equal(oldReserveA + donation);
            expect(newReserveB).to.equal(oldReserveB);
        });

        it("should emit Sync event", async function () {
            const amount = ethers.parseEther("1000");
            await pool.connect(alice).addLiquidity(amount, amount);

            await expect(pool.sync()).to.emit(pool, "Sync").withArgs(
                await pool.reserveA(),
                await pool.reserveB()
            );
        });
    });

    describe("Normal operations", function () {
        it("should allow adding and removing liquidity in correct proportions", async function () {
            const amountA = ethers.parseEther("2000");
            const amountB = ethers.parseEther("1000");

            // Alice adds liquidity at a 2:1 ratio
            await pool.connect(alice).addLiquidity(amountA, amountB);
            const aliceLp = await pool.balanceOf(alice.address);
            expect(aliceLp).to.be.gt(0);

            // Bob adds liquidity at the same ratio
            await pool.connect(owner).addLiquidity(ethers.parseEther("2000"), ethers.parseEther("1000"));
            const bobLp = await pool.balanceOf(owner.address);
            expect(bobLp).to.be.gt(0);

            // Alice removes — she should get back her proportional share
            const reservesA = await pool.reserveA();
            const reservesB = await pool.reserveB();
            const totalSupply = await pool.totalSupply();

            const expectedA = aliceLp * reservesA / totalSupply;
            const expectedB = aliceLp * reservesB / totalSupply;

            const aliceTokenABefore = await tokenA.balanceOf(alice.address);

            await pool.connect(alice).removeLiquidity(aliceLp);

            const aliceTokenABal = await tokenA.balanceOf(alice.address);
            const aliceTokenBBal = await tokenB.balanceOf(alice.address);

            // Alice started with 10000, sent 2000 + 1000, gets back proportional amounts
            expect(aliceTokenABal).to.be.closeTo(
                ethers.parseEther("10000") - amountA + expectedA,
                ethers.parseEther("1")
            );
            expect(aliceTokenBBal).to.be.closeTo(
                ethers.parseEther("10000") - amountB + expectedB,
                ethers.parseEther("1")
            );
        });

        it("should revert on removal with insufficient LP tokens", async function () {
            const amount = ethers.parseEther("1000");
            await pool.connect(alice).addLiquidity(amount, amount);

            // Bob has no LP tokens
            const bob = (await ethers.getSigners())[3];
            await expect(
                pool.connect(bob).removeLiquidity(1)
            ).to.be.revertedWith("Insufficient LP tokens");
        });

        it("should revert on removal with zero LP tokens", async function () {
            await expect(
                pool.connect(alice).removeLiquidity(0)
            ).to.be.revertedWith("Must burn > 0");
        });

        it("should handle multiple sequential deposits by same user", async function () {
            const amount = ethers.parseEther("500");

            await pool.connect(alice).addLiquidity(amount, amount);
            const lp1 = await pool.balanceOf(alice.address);

            await pool.connect(alice).addLiquidity(amount, amount);
            const lp2 = await pool.balanceOf(alice.address);

            // Second deposit should increase LP tokens
            expect(lp2).to.be.gt(lp1);
        });
    });

    describe("Edge cases", function () {
        it("should revert first deposit when sqrt results are too small", async function () {
            // Deposit so small that sqrt(amountA * amountB) <= MINIMUM_LIQUIDITY
            // sqrt(1000 * 1000) = 1000, which is NOT > 1000 (MINIMUM_LIQUIDITY)
            const tooSmall = 1000n; // sqrt(1000 * 1000) = 1000
            await expect(
                pool.connect(alice).addLiquidity(tooSmall, tooSmall)
            ).to.be.revertedWith("Insufficient liquidity");
        });
    });
});
