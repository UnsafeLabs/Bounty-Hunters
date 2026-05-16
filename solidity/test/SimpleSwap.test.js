const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SimpleSwap Slippage Protection", function () {
    let simpleSwap, owner, user;
    const INITIAL_RESERVE_IN = ethers.parseEther("100");
    const INITIAL_RESERVE_OUT = ethers.parseEther("200");

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();
        const SimpleSwap = await ethers.getContractFactory("SimpleSwap");
        simpleSwap = await SimpleSwap.deploy();
        await simpleSwap.waitForDeployment();
        await simpleSwap.addLiquidity(INITIAL_RESERVE_IN, INITIAL_RESERVE_OUT);
    });

    it("should execute swap with valid minAmountOut and deadline", async function () {
        const amountIn = ethers.parseEther("1");
        const minAmountOut = ethers.parseEther("1.9");
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        const amountOut = await simpleSwap.connect(user).swap.staticCall(amountIn, minAmountOut, deadline);
        expect(amountOut).to.be.gte(minAmountOut);

        const tx = await simpleSwap.connect(user).swap(amountIn, minAmountOut, deadline);
        await tx.wait();

        await expect(tx)
            .to.emit(simpleSwap, "Swap")
            .withArgs(user.address, amountIn, amountOut, minAmountOut, deadline);
    });

    it("should revert when slippage exceeds minAmountOut", async function () {
        const amountIn = ethers.parseEther("0.1");
        const unfairMinAmount = ethers.parseEther("100");
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        await expect(
            simpleSwap.connect(user).swap(amountIn, unfairMinAmount, deadline)
        ).to.be.revertedWith("Slippage exceeded");
    });

    it("should revert when deadline has passed", async function () {
        const amountIn = ethers.parseEther("1");
        const minAmountOut = ethers.parseEther("1");
        const pastDeadline = Math.floor(Date.now() / 1000) - 60;

        await expect(
            simpleSwap.connect(user).swap(amountIn, minAmountOut, pastDeadline)
        ).to.be.revertedWith("Transaction expired");
    });

    it("should revert with zero minAmountOut", async function () {
        const amountIn = ethers.parseEther("1");
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        await expect(
            simpleSwap.connect(user).swap(amountIn, 0, deadline)
        ).to.be.revertedWith("Minimum amount out must be positive");
    });

    it("should revert with zero amountIn", async function () {
        const minAmountOut = ethers.parseEther("1");
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        await expect(
            simpleSwap.connect(user).swap(0, minAmountOut, deadline)
        ).to.be.revertedWith("Amount in must be positive");
    });

    it("should revert when pool is not initialized", async function () {
        const emptySwap = await (await ethers.getContractFactory("SimpleSwap")).deploy();
        await emptySwap.waitForDeployment();
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        await expect(
            emptySwap.connect(user).swap(ethers.parseEther("1"), ethers.parseEther("1"), deadline)
        ).to.be.revertedWith("Pool not initialized");
    });

    it("should compute correct getAmountOut", async function () {
        const amountIn = ethers.parseEther("1");
        const expectedOut = await simpleSwap.getAmountOut(amountIn);
        expect(expectedOut).to.be.gt(0);
    });

    it("should emit Swap event with correct parameters", async function () {
        const amountIn = ethers.parseEther("1");
        const minAmountOut = ethers.parseEther("1.9");
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        await expect(
            simpleSwap.connect(user).swap(amountIn, minAmountOut, deadline)
        )
            .to.emit(simpleSwap, "Swap")
            .withArgs(user.address, amountIn, await simpleSwap.connect(user).swap.staticCall(amountIn, minAmountOut, deadline), minAmountOut, deadline);
    });
});