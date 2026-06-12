const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("YieldVault", function () {
    let vault;
    let rewardToken;
    let stakingToken;
    let owner;
    let user;

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();
        
        const Token = await ethers.getContractFactory("MockERC20");
        rewardToken = await Token.deploy("Reward", "RWD", 18);
        stakingToken = await Token.deploy("Stake", "STK", 18);
        
        const Vault = await ethers.getContractFactory("YieldVault");
        vault = await Vault.deploy(stakingToken.address, rewardToken.address);

        await stakingToken.transfer(user.address, ethers.utils.parseEther("100"));
        await stakingToken.connect(user).approve(vault.address, ethers.constants.MaxUint256);
        await rewardToken.transfer(vault.address, ethers.utils.parseEther("1000"));
    });

    it("Should not accrue phantom rewards after period finishes", async function () {
        await vault.notifyRewardAmount(ethers.utils.parseEther("100"), 100);
        
        await vault.connect(user).deposit(ethers.utils.parseEther("10"));

        // Advance time to exactly the end of the period
        await time.increase(100);
        
        // Trigger an update
        await vault.connect(user).withdraw(0);
        const earnedAtEnd = await vault.earned(user.address);

        // Advance time way past the period
        await time.increase(500);
        
        // Trigger another update
        await vault.connect(user).withdraw(0);
        const earnedAfterEnd = await vault.earned(user.address);

        // Rewards should not have increased after the period ended
        expect(earnedAfterEnd).to.be.closeTo(earnedAtEnd, 10);
    });

    it("Should restrict notifyRewardAmount to rewardDistributor", async function () {
        await expect(vault.connect(user).notifyRewardAmount(100, 100))
            .to.be.revertedWith("Caller is not reward distributor");
    });
});
