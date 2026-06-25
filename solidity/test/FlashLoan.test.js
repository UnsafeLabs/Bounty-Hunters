const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashLoan Security Tests", function () {
    let flashLoan;
    let token;
    let owner;
    let user;
    let receiver;

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();

        // Deploy Mock ERC20 Token
        const Token = await ethers.getContractFactory("MockERC20");
        token = await Token.deploy("Loan Token", "LNT", 18);
        await token.deployed();

        // Deploy FlashLoan with 10 BPS (0.1%) fee
        const FlashLoan = await ethers.getContractFactory("FlashLoan");
        flashLoan = await FlashLoan.deploy(token.address, 10);
        await flashLoan.deployed();

        // Deploy Mock FlashLoan Receiver
        const Receiver = await ethers.getContractFactory("MockFlashLoanReceiver");
        receiver = await Receiver.deploy();
        await receiver.deployed();

        // Setup Pool: deposit 1000 tokens from owner
        await token.approve(flashLoan.address, ethers.utils.parseEther("1000"));
        await flashLoan.depositToPool(ethers.utils.parseEther("1000"));

        // Give some tokens to receiver contract so it can pay the fee
        await token.transfer(receiver.address, ethers.utils.parseEther("10"));
    });

    it("Should execute flash loan successfully when fee is paid", async function () {
        const loanAmount = ethers.utils.parseEther("100");
        
        // Approve receiver to spend its own tokens to repay the loan
        await token.transfer(receiver.address, ethers.utils.parseEther("10")); // extra funds for fee
        
        // Receiver needs to approve FlashLoan contract to pull tokens
        // Wait, in MockFlashLoanReceiver:
        // IERC20(token).transfer(msg.sender, amount + fee);
        // It does a transfer, so approval is not needed because it transfers directly!
        
        const balanceBefore = await token.balanceOf(receiver.address);
        
        await expect(receiver.initiateFlashLoan(flashLoan.address, loanAmount))
            .to.emit(flashLoan, "FlashLoanExecuted");

        const balanceAfter = await token.balanceOf(receiver.address);
        // It should cost exactly the fee (0.1% of 100 = 0.1)
        expect(balanceBefore.sub(balanceAfter)).to.equal(ethers.utils.parseEther("0.1"));
    });

    it("Should charge a minimum fee of 1 unit for tiny loans", async function () {
        // Loan of 100 units. Fee = 100 * 10 / 10000 = 0.1 units (truncates to 0)
        // With fix, it should charge 1 unit.
        const loanAmount = 100;
        
        const balanceBefore = await token.balanceOf(receiver.address);
        await receiver.initiateFlashLoan(flashLoan.address, loanAmount);
        const balanceAfter = await token.balanceOf(receiver.address);
        
        expect(balanceBefore.sub(balanceAfter)).to.equal(1); // Cost must be exactly 1 unit
    });

    it("Should reject loans exceeding 50% of pool", async function () {
        const loanAmount = ethers.utils.parseEther("501"); // 50.1% of 1000 pool
        await expect(receiver.initiateFlashLoan(flashLoan.address, loanAmount))
            .to.be.revertedWith("Loan exceeds 50% of pool");
    });

    it("Should respect pause and unpause states", async function () {
        await flashLoan.setPaused(true);
        await expect(receiver.initiateFlashLoan(flashLoan.address, ethers.utils.parseEther("10")))
            .to.be.revertedWith("Paused");

        await flashLoan.setPaused(false);
        await expect(receiver.initiateFlashLoan(flashLoan.address, ethers.utils.parseEther("10")))
            .to.emit(flashLoan, "FlashLoanExecuted");
    });

    it("Should revert if loan is not repaid", async function () {
        await receiver.setDoRepay(false);
        await expect(receiver.initiateFlashLoan(flashLoan.address, ethers.utils.parseEther("10")))
            .to.be.revertedWith("Loan not repaid");
    });
});
