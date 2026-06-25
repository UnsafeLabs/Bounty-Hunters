const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault Security Tests", function () {
    let vault;
    let token;
    let owner;
    let user;
    let attacker;

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();

        const Token = await ethers.getContractFactory("MockERC20");
        token = await Token.deploy("Staking Token", "STK", 18);
        await token.deployed();

        const StakingVault = await ethers.getContractFactory("StakingVault");
        vault = await StakingVault.deploy(token.address, ethers.utils.parseEther("0.1"));
        await vault.deployed();

        await token.transfer(user.address, ethers.utils.parseEther("100"));
        await token.connect(user).approve(vault.address, ethers.utils.parseEther("100"));
    });

    it("Should allow staking and withdrawal", async function () {
        const amount = ethers.utils.parseEther("10");
        
        await vault.connect(user).stake(amount);
        expect(await vault.getStakedBalance(user.address)).to.equal(amount);
        expect(await vault.totalStaked()).to.equal(amount);

        // Send ether to vault so it has funds to pay out withdrawals (since withdraw transfers ETH)
        await owner.sendTransaction({
            to: vault.address,
            value: ethers.utils.parseEther("20")
        });

        await expect(vault.connect(user).withdraw(amount))
            .to.emit(vault, "Withdrawn")
            .withArgs(user.address, amount);

        expect(await vault.getStakedBalance(user.address)).to.equal(0);
    });

    it("Should prevent reentrancy attacks", async function () {
        const amount = ethers.utils.parseEther("5");

        const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
        attacker = await Attacker.deploy(vault.address, token.address);
        await attacker.deployed();

        await token.transfer(attacker.address, amount);

        await owner.sendTransaction({
            to: vault.address,
            value: ethers.utils.parseEther("20")
        });

        // The attack should fail because of ReentrancyGuard
        await expect(attacker.attack(amount)).to.be.reverted;
    });
});
