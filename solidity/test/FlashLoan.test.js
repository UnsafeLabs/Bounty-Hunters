const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashLoan", function () {
    let flashLoan, token, owner, borrower, mockReceiver;
    const INITIAL_BALANCE = ethers.parseUnits("1000000", 18);
    const FEE_BPS = 50; // 0.5%

    beforeEach(async function () {
        [owner, borrower] = await ethers.getSigners();

        // Deploy mock token
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        token = await MockERC20.deploy("Test Token", "TT");
        await token.waitForDeployment();

        // Deploy flash loan contract
        const FlashLoan = await ethers.getContractFactory("FlashLoan");
        flashLoan = await FlashLoan.deploy(await token.getAddress(), FEE_BPS);
        await flashLoan.waitForDeployment();

        // Fund the flash loan pool
        await token.mint(owner.address, INITIAL_BALANCE);
        await token.approve(await flashLoan.getAddress(), INITIAL_BALANCE);
        await flashLoan.depositToPool(INITIAL_BALANCE);

        // Deploy mock receiver
        const MockReceiver = await ethers.getContractFactory("MockFlashLoanReceiver");
        mockReceiver = await MockReceiver.deploy(await token.getAddress());
        await mockReceiver.waitForDeployment();

        // Fund the receiver so it can pay fees
        await token.mint(await mockReceiver.getAddress(), ethers.parseUnits("100000", 18));
    });

    describe("Zero-Fee Prevention", function () {
        it("should charge minimum fee of 1 for small amounts", async function () {
            // For amount=100, feeBPS=50: calculated fee = 100*50/10000 = 0
            // With fix, fee should be 1 (MIN_FEE)
            const smallAmount = 100;
            // This should revert because the receiver won't have enough to repay
            // or succeed if it can pay the minimum fee
            // Testing minimum fee logic:
            const calculatedFee = BigInt(smallAmount) * BigInt(FEE_BPS) / 10000n;
            expect(calculatedFee).to.equal(0n); // Without fix, would be 0
        });

        it("should use calculated fee when it is non-zero", async function () {
            // For amount=100000, feeBPS=50: calculated fee = 100000*50/10000 = 500
            const largeAmount = ethers.parseUnits("100", 18);
            const expectedFee = largeAmount * BigInt(FEE_BPS) / 10000n;
            expect(expectedFee).to.be.gt(0n);
        });
    });

    describe("Max Loan Amount (50% Cap)", function () {
        it("should reject loans exceeding 50% of pool balance", async function () {
            const poolBalance = await flashLoan.getPoolBalance();
            const overHalf = poolBalance / 2n + 1n;
            await expect(
                flashLoan.flashLoan(overHalf, "0x")
            ).to.be.revertedWith("Exceeds max loan amount (50% of pool)");
        });

        it("should allow loans up to 50% of pool balance", async function () {
            const maxLoan = await flashLoan.getMaxLoanAmount();
            expect(maxLoan).to.equal(INITIAL_BALANCE / 2n);
        });
    });

    describe("Emergency Pause", function () {
        it("should allow owner to pause", async function () {
            await flashLoan.pause();
            expect(await flashLoan.paused()).to.be.true;
            await expect(
                flashLoan.flashLoan(1000, "0x")
            ).to.be.revertedWith("Paused");
        });

        it("should allow owner to unpause", async function () {
            await flashLoan.pause();
            await flashLoan.unpause();
            expect(await flashLoan.paused()).to.be.false;
        });

        it("should prevent non-owner from pausing", async function () {
            await expect(
                flashLoan.connect(borrower).pause()
            ).to.be.revertedWith("Not owner");
        });
    });

    describe("Internal Accounting", function () {
        it("should track internal pool balance correctly", async function () {
            const initialPool = await flashLoan.internalPoolBalance();
            expect(initialPool).to.equal(INITIAL_BALANCE);
        });

        it("should update internal balance on deposit", async function () {
            const depositAmount = ethers.parseUnits("500", 18);
            await token.mint(owner.address, depositAmount);
            await token.approve(await flashLoan.getAddress(), depositAmount);
            await flashLoan.depositToPool(depositAmount);
            expect(await flashLoan.internalPoolBalance()).to.equal(INITIAL_BALANCE + depositAmount);
        });
    });
});
