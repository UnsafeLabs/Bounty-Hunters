const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SimpleSwap", function () {
    let swap, tokenA, tokenB, owner, alice, attacker;
    const FEE_BPS = 30n; // 0.3%

    beforeEach(async function () {
        [owner, alice, attacker] = await ethers.getSigners();

        // Deploy mock tokens
        const MockFactory = await ethers.getContractFactory("MockERC20");
        tokenA = await MockFactory.deploy("Token A", "TKA", ethers.parseEther("1000000"));
        await tokenA.waitForDeployment();
        tokenB = await MockFactory.deploy("Token B", "TKB", ethers.parseEther("1000000"));
        await tokenB.waitForDeployment();

        // Deploy SimpleSwap
        const SimpleSwap = await ethers.getContractFactory("SimpleSwap");
        swap = await SimpleSwap.deploy(
            await tokenA.getAddress(),
            await tokenB.getAddress(),
            FEE_BPS
        );
        await swap.waitForDeployment();

        // Fund alice and attacker
        await tokenA.transfer(alice.address, ethers.parseEther("10000"));
        await tokenB.transfer(alice.address, ethers.parseEther("10000"));
        await tokenA.transfer(attacker.address, ethers.parseEther("10000"));
        await tokenB.transfer(attacker.address, ethers.parseEther("10000"));

        // Approve
        for (const signer of [alice, attacker, owner]) {
            await tokenA.connect(signer).approve(await swap.getAddress(), ethers.MaxUint256);
            await tokenB.connect(signer).approve(await swap.getAddress(), ethers.MaxUint256);
        }

        // Add initial liquidity (owner adds 100k of each)
        await tokenA.connect(owner).transfer(await swap.getAddress(), ethers.parseEther("100000"));
        await tokenB.connect(owner).transfer(await swap.getAddress(), ethers.parseEther("100000"));
        await swap.connect(owner).addLiquidity(ethers.parseEther("100000"), ethers.parseEther("100000"));
    });

    describe("Slippage protection", function () {
        it("should succeed when amountOut meets minAmountOut", async function () {
            const amountIn = ethers.parseEther("100");
            const expectedOut = await swap.getAmountOut(await tokenA.getAddress(), amountIn);
            const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

            await expect(
                swap.connect(alice).swap(
                    await tokenA.getAddress(),
                    amountIn,
                    expectedOut,   // exact expected = no slippage
                    deadline
                )
            ).to.not.be.reverted;
        });

        it("should revert when slippage exceeds minAmountOut", async function () {
            const amountIn = ethers.parseEther("100");
            const expectedOut = await swap.getAmountOut(await tokenA.getAddress(), amountIn);

            // Set minAmountOut higher than expected
            const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

            await expect(
                swap.connect(alice).swap(
                    await tokenA.getAddress(),
                    amountIn,
                    expectedOut + 1n, // one wei above what's possible
                    deadline
                )
            ).to.be.revertedWith("Slippage exceeded");
        });

        it("should allow swap with zero minAmountOut (no protection)", async function () {
            const amountIn = ethers.parseEther("100");
            const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

            await expect(
                swap.connect(alice).swap(
                    await tokenA.getAddress(),
                    amountIn,
                    0n,
                    deadline
                )
            ).to.not.be.reverted;
        });
    });

    describe("Deadline protection", function () {
        it("should succeed when deadline is in the future", async function () {
            const amountIn = ethers.parseEther("100");
            const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

            await expect(
                swap.connect(alice).swap(
                    await tokenA.getAddress(),
                    amountIn,
                    0n,
                    deadline
                )
            ).to.not.be.reverted;
        });

        it("should revert when deadline is past", async function () {
            const amountIn = ethers.parseEther("100");
            const deadline = (await ethers.provider.getBlock("latest")).timestamp - 1; // already expired

            await expect(
                swap.connect(alice).swap(
                    await tokenA.getAddress(),
                    amountIn,
                    0n,
                    deadline
                )
            ).to.be.revertedWith("Expired");
        });
    });

    describe("Fee precision", function () {
        it("should charge at least 1 wei fee for tiny amounts", async function () {
            // With 30 bps fee, amountIn=33 gives 33*30/10000 = 0 wei fee (floor to 0)
            // Our fix ensures feeAmount = 1 wei, so amountInAfterFee = 32 wei
            const amountIn = 33n;
            const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

            await swap.connect(alice).swap(
                await tokenA.getAddress(),
                amountIn,
                0n,
                deadline
            );

            // Alice should have sent 33 wei of tokenA
            const aliceBalAfterA = await tokenA.balanceOf(alice.address);
            expect(aliceBalAfterA).to.equal(ethers.parseEther("10000") - amountIn);
        });

        it("should calculate fee correctly for normal amounts", async function () {
            const amountIn = ethers.parseEther("1000"); // 1000 tokens
            const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

            const aliceBalBeforeA = await tokenA.balanceOf(alice.address);
            const aliceBalBeforeB = await tokenB.balanceOf(alice.address);

            await swap.connect(alice).swap(
                await tokenA.getAddress(),
                amountIn,
                0n,
                deadline
            );

            // Alice should have sent amountIn of tokenA
            const aliceBalAfterA = await tokenA.balanceOf(alice.address);
            expect(aliceBalAfterA).to.equal(aliceBalBeforeA - amountIn);

            // Alice should have received some tokenB
            const aliceBalAfterB = await tokenB.balanceOf(alice.address);
            expect(aliceBalAfterB).to.be.gt(aliceBalBeforeB);
        });
    });

    describe("Normal swap operations", function () {
        it("should swap tokenA for tokenB correctly", async function () {
            const amountIn = ethers.parseEther("1000");
            const expectedOut = await swap.getAmountOut(await tokenA.getAddress(), amountIn);
            const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

            const tx = await swap.connect(alice).swap(
                await tokenA.getAddress(),
                amountIn,
                expectedOut,
                deadline
            );
            const receipt = await tx.wait();

            const event = receipt.logs.find(
                log => log.fragment?.name === "Swap"
            );
            expect(event).to.not.be.undefined;
            expect(event.args[0]).to.equal(alice.address);
            expect(event.args[1]).to.equal(await tokenA.getAddress());
            expect(event.args[2]).to.equal(amountIn);
            expect(event.args[3]).to.equal(expectedOut);
        });

        it("should swap tokenB for tokenA correctly", async function () {
            const amountIn = ethers.parseEther("500");
            const expectedOut = await swap.getAmountOut(await tokenB.getAddress(), amountIn);
            const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

            await expect(
                swap.connect(alice).swap(
                    await tokenB.getAddress(),
                    amountIn,
                    expectedOut,
                    deadline
                )
            ).to.not.be.reverted;
        });

        it("should reject invalid token address", async function () {
            const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
            await expect(
                swap.connect(alice).swap(
                    ethers.ZeroAddress,
                    ethers.parseEther("100"),
                    0n,
                    deadline
                )
            ).to.be.revertedWith("Invalid token");
        });

        it("should reject zero amount", async function () {
            const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
            await expect(
                swap.connect(alice).swap(
                    await tokenA.getAddress(),
                    0n,
                    0n,
                    deadline
                )
            ).to.be.revertedWith("Amount must be > 0");
        });
    });
});
