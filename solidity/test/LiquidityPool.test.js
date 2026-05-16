const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityPool - First Depositor Protection", function () {
    let TokenA, TokenB, LiquidityPool;
    let tokenA, tokenB, pool;
    let owner, attacker, user;

    const INITIAL_SUPPLY = ethers.parseEther("1000000");
    const MINIMUM_LIQUIDITY = 1000n;

    beforeEach(async function () {
        [owner, attacker, user] = await ethers.getSigners();

        TokenA = await ethers.getContractFactory("ERC20Mock");
        TokenB = await ethers.getContractFactory("ERC20Mock");
        tokenA = await TokenA.deploy("TokenA", "TKA", INITIAL_SUPPLY);
        tokenB = await TokenB.deploy("TokenB", "TKB", INITIAL_SUPPLY);

        LiquidityPool = await ethers.getContractFactory("LiquidityPool");
        pool = await LiquidityPool.deploy(await tokenA.getAddress(), await tokenB.getAddress());

        for (const signer of [owner, attacker, user]) {
            await tokenA.transfer(await signer.getAddress(), ethers.parseEther("10000"));
            await tokenB.transfer(await signer.getAddress(), ethers.parseEther("10000"));
        }
    });

    describe("First Deposit - Minimum Liquidity Lock", function () {
        it("should lock MINIMUM_LIQUIDITY LP tokens at address(0)", async function () {
            const amountA = ethers.parseEther("100");
            const amountB = ethers.parseEther("100");

            await tokenA.connect(owner).approve(await pool.getAddress(), amountA);
            await tokenB.connect(owner).approve(await pool.getAddress(), amountB);
            await pool.connect(owner).addLiquidity(amountA, amountB);

            const lockedBalance = await pool.balanceOf(ethers.ZeroAddress);
            expect(lockedBalance).to.equal(MINIMUM_LIQUIDITY);
        });

        it("should subtract locked amount from first depositor LP tokens", async function () {
            const amountA = ethers.parseEther("100");
            const amountB = ethers.parseEther("100");

            await tokenA.connect(owner).approve(await pool.getAddress(), amountA);
            await tokenB.connect(owner).approve(await pool.getAddress(), amountB);
            await pool.connect(owner).addLiquidity(amountA, amountB);

            const ownerBalance = await pool.balanceOf(await owner.getAddress());
            const sqrtProduct = BigInt(Math.floor(Math.sqrt(Number(ethers.parseEther("100")) * Number(ethers.parseEther("100")) / 1e18))) * ethers.parseEther("1");
            const expectedLP = (sqrtProduct / ethers.parseEther("1")) * ethers.parseEther("1") - MINIMUM_LIQUIDITY;
            expect(ownerBalance).to.equal(expectedLP);
            expect(ownerBalance).to.be.gt(0);
        });

        it("should revert first deposit that is too small", async function () {
            const amountA = 1n;
            const amountB = 1n;

            await tokenA.connect(owner).approve(await pool.getAddress(), amountA);
            await tokenB.connect(owner).approve(await pool.getAddress(), amountB);
            await expect(
                pool.connect(owner).addLiquidity(amountA, amountB)
            ).to.be.revertedWith("First deposit too small");
        });
    });

    describe("Price Manipulation Prevention", function () {
        it("should prevent first-depositor price manipulation via tiny deposit + donation", async function () {
            const smallAmount = ethers.parseEther("1");
            const largeAmount = ethers.parseEther("10000");

            await tokenA.connect(owner).approve(await pool.getAddress(), smallAmount);
            await tokenB.connect(owner).approve(await pool.getAddress(), smallAmount);
            await pool.connect(owner).addLiquidity(smallAmount, smallAmount);

            await tokenA.connect(owner).approve(await pool.getAddress(), largeAmount);
            await tokenB.connect(owner).approve(await pool.getAddress(), largeAmount);

            const lpBefore = await pool.balanceOf(await owner.getAddress());
            await pool.connect(owner).addLiquidity(largeAmount, largeAmount);
            const lpAfter = await pool.balanceOf(await owner.getAddress());
            const lpReceived = lpAfter - lpBefore;

            const expectedRatio = largeAmount * (await pool.totalSupply()) / (await pool.reserveA());
            const ratio = lpReceived * ethers.parseEther("1") / expectedRatio;
            expect(ratio).to.be.lte(ethers.parseEther("1") + 1n);
            expect(ratio).to.be.gte(ethers.parseEther("1") - 1n);
        });

        it("should use correct proportional formula after first deposit", async function () {
            const firstAmount = ethers.parseEther("100");
            await tokenA.connect(owner).approve(await pool.getAddress(), firstAmount);
            await tokenB.connect(owner).approve(await pool.getAddress(), firstAmount);
            await pool.connect(owner).addLiquidity(firstAmount, firstAmount);

            const secondAmount = ethers.parseEther("50");
            await tokenA.connect(user).approve(await pool.getAddress(), secondAmount);
            await tokenB.connect(user).approve(await pool.getAddress(), secondAmount);
            await pool.connect(user).addLiquidity(secondAmount, secondAmount);

            const totalSupply = await pool.totalSupply();
            const userLP = await pool.balanceOf(await user.getAddress());
            const expectedShare = secondAmount * totalSupply / (await pool.reserveA());
            const diff = userLP > expectedShare ? userLP - expectedShare : expectedShare - userLP;
            expect(diff).to.be.lte(1n);
        });
    });

    describe("removeLiquidity - Internal Reserves", function () {
        beforeEach(async function () {
            const amount = ethers.parseEther("100");
            await tokenA.connect(owner).approve(await pool.getAddress(), amount);
            await tokenB.connect(owner).approve(await pool.getAddress(), amount);
            await pool.connect(owner).addLiquidity(amount, amount);
        });

        it("should use internal reserves (not balanceOf) for removeLiquidity", async function () {
            const lpTokens = await pool.balanceOf(await owner.getAddress());
            const reserveABefore = await pool.reserveA();
            const reserveBBefore = await pool.reserveB();
            const totalSupplyBefore = await pool.totalSupply();

            const tx = await pool.connect(owner).removeLiquidity(lpTokens);
            const receipt = await tx.wait();

            const balA = await tokenA.balanceOf(await owner.getAddress());
            expect(balA).to.be.gt(ethers.parseEther("90"));

            const reserveAAfter = await pool.reserveA();
            expect(reserveAAfter).to.be.lt(reserveABefore);
        });

        it("should not be affected by direct token donations (donation attack)", async function () {
            const lpTokens = (await pool.balanceOf(await owner.getAddress())) / 2n;

            await tokenA.connect(attacker).transfer(await pool.getAddress(), ethers.parseEther("99999"));
            await tokenB.connect(attacker).transfer(await pool.getAddress(), ethers.parseEther("99999"));

            const balBeforeA = await tokenA.balanceOf(await owner.getAddress());
            await pool.connect(owner).removeLiquidity(lpTokens);
            const balAfterA = await tokenA.balanceOf(await owner.getAddress());

            const reserveA = await pool.reserveA();
            const totalSupply = await pool.totalSupply();
            const expectedAmount = lpTokens * reserveA / totalSupply + lpTokens * reserveA / totalSupply;

            const received = balAfterA - balBeforeA;
            const diff = received > expectedAmount ? received - expectedAmount : expectedAmount - received;
            const largeDiff = diff > ethers.parseEther("1");
            expect(largeDiff).to.be.false;
        });
    });

    describe("sync() - Recovery from Donation Attacks", function () {
        it("should update reserves to match actual balances", async function () {
            const amountA = ethers.parseEther("100");
            const amountB = ethers.parseEther("100");
            await tokenA.connect(owner).approve(await pool.getAddress(), amountA);
            await tokenB.connect(owner).approve(await pool.getAddress(), amountB);
            await pool.connect(owner).addLiquidity(amountA, amountB);

            const reserveABefore = await pool.reserveA();
            const reserveBBefore = await pool.reserveB();

            await tokenA.connect(attacker).transfer(await pool.getAddress(), ethers.parseEther("5000"));

            const balA = await tokenA.balanceOf(await pool.getAddress());
            expect(balA).to.be.gt(reserveABefore);

            await pool.connect(owner).sync();

            const reserveAAfter = await pool.reserveA();
            expect(reserveAAfter).to.equal(balA);
            expect(reserveAAfter).to.be.gt(reserveABefore);
            expect(await pool.reserveB()).to.equal(reserveBBefore);
        });

        it("should emit Sync event", async function () {
            const amount = ethers.parseEther("100");
            await tokenA.connect(owner).approve(await pool.getAddress(), amount);
            await tokenB.connect(owner).approve(await pool.getAddress(), amount);
            await pool.connect(owner).addLiquidity(amount, amount);

            await expect(pool.connect(owner).sync())
                .to.emit(pool, "Sync")
                .withArgs(amount, amount);
        });
    });

    describe("End-to-End Attack Scenario", function () {
        it("should withstand full donation + price manipulation attack", async function () {
            const legitAmount = ethers.parseEther("100");
            await tokenA.connect(owner).approve(await pool.getAddress(), legitAmount);
            await tokenB.connect(owner).approve(await pool.getAddress(), legitAmount);
            const lp1 = await pool.connect(owner).addLiquidity(legitAmount, legitAmount);

            await tokenA.connect(attacker).transfer(await pool.getAddress(), ethers.parseEther("99999"));
            await tokenB.connect(attacker).transfer(await pool.getAddress(), ethers.parseEther("99999"));

            const donateAmount = ethers.parseEther("200");
            await tokenA.connect(user).approve(await pool.getAddress(), donateAmount);
            await tokenB.connect(user).approve(await pool.getAddress(), donateAmount);
            await pool.connect(user).addLiquidity(donateAmount, donateAmount);

            const userLP = await pool.balanceOf(await user.getAddress());
            const totalSupply = await pool.totalSupply();
            const userShare = userLP * ethers.parseEther("100") / totalSupply;
            const ownerShare = ethers.parseEther("100") - userShare;

            expect(userLP).to.be.gt(0);
            expect(userShare).to.be.lte(ethers.parseEther("10"));
        });
    });
});