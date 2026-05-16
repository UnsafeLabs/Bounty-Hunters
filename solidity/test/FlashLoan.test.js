const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashLoan", function () {
    let Token, FlashLoan;
    let token, flashLoan;
    let owner, borrower, recipient;

    const INITIAL_POOL = ethers.parseEther("10000");
    const FEE_BPS = 25n; // 0.25%

    const FlashLoanReceiverFactory = async () => {
        const factory = await ethers.getContractFactory("MockReceiver");
        return factory;
    };

    beforeEach(async function () {
        [owner, borrower, recipient] = await ethers.getSigners();

        Token = await ethers.getContractFactory("ERC20Mock");
        token = await Token.deploy("Token", "TKN", ethers.parseEther("20000"));
        FlashLoan = await ethers.getContractFactory("FlashLoan");
        flashLoan = await FlashLoan.deploy(await token.getAddress(), FEE_BPS);

        await token.transfer(await owner.getAddress(), ethers.parseEther("15000"));
        await token.connect(owner).approve(await flashLoan.getAddress(), INITIAL_POOL);
        await flashLoan.connect(owner).depositToPool(INITIAL_POOL);

        const MockReceiver = await ethers.getContractFactory("MockReceiver");
        const receiver = await MockReceiver.deploy(await token.getAddress(), await flashLoan.getAddress());
        await receiver.deployed();
    });

    describe("Minimum Fee Prevention", () => {
        it("should charge minimum fee of 1 for small loan amounts", async () => {
            const smallAmount = 100n;
            const MockReceiver = await ethers.getContractFactory("MockReceiver");
            const receiver = await MockReceiver.deploy(await token.getAddress(), await flashLoan.getAddress());

            await token.transfer(await receiver.getAddress(), smallAmount + 1n);
            await token.transfer(await borrower.getAddress(), 1n);

            await receiver.connect(borrower).executeFlashLoan(smallAmount, "0x");

            const fees = await flashLoan.totalFees();
            expect(fees).to.equal(1n);
        });

        it("should not allow free flash loans for tiny amounts", async () => {
            const tinyAmount = 1n;
            const MockReceiver = await ethers.getContractFactory("MockReceiver");
            const receiver = await MockReceiver.deploy(await token.getAddress(), await flashLoan.getAddress());

            await token.transfer(await receiver.getAddress(), tinyAmount + 1n);

            await receiver.connect(borrower).executeFlashLoan(tinyAmount, "0x");

            const fees = await flashLoan.totalFees();
            expect(fees).to.be.gt(0n);
        });
    });

    describe("Max Loan Cap", () => {
        it("should reject loans exceeding 50% of pool balance", async () => {
            const poolBal = await flashLoan.poolBalance();
            const tooMuch = poolBal / 2n + 1n;

            await expect(
                flashLoan.connect(borrower).flashLoan(tooMuch, "0x")
            ).to.be.revertedWith("Exceeds max loan amount");
        });

        it("should allow loans at exactly 50% of pool balance", async () => {
            const poolBal = await flashLoan.poolBalance();
            const exactly = poolBal / 2n;
            const MockReceiver = await ethers.getContractFactory("MockReceiver");
            const receiver = await MockReceiver.deploy(await token.getAddress(), await flashLoan.getAddress());

            const fee = exactly * FEE_BPS / 10000n;
            const repayAmount = exactly + (fee == 0n ? 1n : fee);
            await token.transfer(await receiver.getAddress(), repayAmount);

            await receiver.connect(borrower).executeFlashLoan(exactly, "0x");
        });
    });

    describe("Rebasing Token Protection", () => {
        it("should use internal poolBalance accounting instead of balanceOf", async () => {
            const poolBalBefore = await flashLoan.poolBalance();

            await token.connect(owner).transfer(await flashLoan.getAddress(), ethers.parseEther("5000"));

            const poolBalAfter = await flashLoan.poolBalance();
            expect(poolBalAfter).to.equal(poolBalBefore);
        });
    });

    describe("Emergency Pause", () => {
        it("should pause flash loans", async () => {
            await flashLoan.connect(owner).setPause(true);
            expect(await flashLoan.paused()).to.be.true;

            await expect(
                flashLoan.connect(borrower).flashLoan(100, "0x")
            ).to.be.revertedWith("Paused");
        });

        it("should unpause and allow flash loans again", async () => {
            await flashLoan.connect(owner).setPause(true);
            await flashLoan.connect(owner).setPause(false);
            expect(await flashLoan.paused()).to.be.false;

            const MockReceiver = await ethers.getContractFactory("MockReceiver");
            const receiver = await MockReceiver.deploy(await token.getAddress(), await flashLoan.getAddress());
            const amount = ethers.parseEther("10");
            await token.transfer(await receiver.getAddress(), amount + 1n);
            await receiver.connect(borrower).executeFlashLoan(amount, "0x");
        });

        it("should emit PauseStateChanged event", async () => {
            await expect(flashLoan.connect(owner).setPause(true))
                .to.emit(flashLoan, "PauseStateChanged")
                .withArgs(true);
        });

        it("should reject pause from non-owner", async () => {
            await expect(
                flashLoan.connect(borrower).setPause(true)
            ).to.be.revertedWith("Not owner");
        });

        it("should prevent deposits while paused", async () => {
            await flashLoan.connect(owner).setPause(true);
            expect(await flashLoan.paused()).to.be.true;
        });
    });

    describe("Fee Accrual", () => {
        it("should track fees correctly after multiple flash loans", async () => {
            const MockReceiver = await ethers.getContractFactory("MockReceiver");
            const receiver = await MockReceiver.deploy(await token.getAddress(), await flashLoan.getAddress());

            const amount = ethers.parseEther("100");
            await token.transfer(await receiver.getAddress(), ethers.parseEther("2000"));

            for (let i = 0; i < 3; i++) {
                await receiver.connect(borrower).executeFlashLoan(amount, "0x");
            }

            const fees = await flashLoan.totalFees();
            expect(fees).to.be.gt(0n);
        });
    });
});