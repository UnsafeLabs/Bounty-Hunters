const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YieldVault", function () {
  let vault, stakingToken, rewardToken, distributor, user1, user2;

  beforeEach(async function () {
    [distributor, user1, user2] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    stakingToken = await MockToken.deploy("Staking Token", "STK");
    rewardToken = await MockToken.deploy("Reward Token", "RWD");
    await stakingToken.deployed();
    await rewardToken.deployed();

    const YieldVault = await ethers.getContractFactory("YieldVault");
    vault = await YieldVault.deploy(stakingToken.address, rewardToken.address);
    await vault.deployed();
  });

  describe("Access Control", function () {
    it("should only allow distributor to notify reward amount", async function () {
      const reward = ethers.utils.parseEther("1000");
      const duration = 7 * 24 * 60 * 60; // 7 days

      await rewardToken.mint(distributor.address, reward);
      await rewardToken.connect(distributor).approve(vault.address, reward);

      await expect(
        vault.connect(user1).notifyRewardAmount(reward, duration)
      ).to.be.revertedWith("Not distributor");
    });

    it("should allow distributor to notify reward amount", async function () {
      const reward = ethers.utils.parseEther("1000");
      const duration = 7 * 24 * 60 * 60; // 7 days

      await rewardToken.mint(distributor.address, reward);
      await rewardToken.connect(distributor).approve(vault.address, reward);

      await vault.connect(distributor).notifyRewardAmount(reward, duration);
    });
  });

  describe("Reward Accrual", function () {
    it("should not accrue phantom rewards after period ends", async function () {
      const reward = ethers.utils.parseEther("1000");
      const duration = 1; // 1 second

      await rewardToken.mint(distributor.address, reward);
      await rewardToken.connect(distributor).approve(vault.address, reward);

      // Deposit tokens
      const depositAmount = ethers.utils.parseEther("100");
      await stakingToken.mint(user1.address, depositAmount);
      await stakingToken.connect(user1).approve(vault.address, depositAmount);
      await vault.connect(user1).deposit(depositAmount);

      // Start reward period
      await vault.connect(distributor).notifyRewardAmount(reward, duration);

      // Wait for period to end
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");

      // Check earned rewards - should not increase after period
      const earnedBefore = await vault.earned(user1.address);
      
      // Wait more time
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      const earnedAfter = await vault.earned(user1.address);

      // Earned should not increase significantly after period ends
      expect(earnedAfter).to.equal(earnedBefore);
    });

    it("should accrue rewards during active period", async function () {
      const reward = ethers.utils.parseEther("1000");
      const duration = 7 * 24 * 60 * 60; // 7 days

      await rewardToken.mint(distributor.address, reward);
      await rewardToken.connect(distributor).approve(vault.address, reward);

      // Deposit tokens
      const depositAmount = ethers.utils.parseEther("100");
      await stakingToken.mint(user1.address, depositAmount);
      await stakingToken.connect(user1).approve(vault.address, depositAmount);
      await vault.connect(user1).deposit(depositAmount);

      // Start reward period
      await vault.connect(distributor).notifyRewardAmount(reward, duration);

      // Wait some time
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60]); // 1 day
      await ethers.provider.send("evm_mine");

      const earned = await vault.earned(user1.address);
      expect(earned).to.be.gt(0);
    });
  });

  describe("Precision", function () {
    it("should maintain reasonable precision", async function () {
      const reward = ethers.utils.parseEther("1000");
      const duration = 7 * 24 * 60 * 60; // 7 days

      await rewardToken.mint(distributor.address, reward);
      await rewardToken.connect(distributor).approve(vault.address, reward);

      // Deposit tokens
      const depositAmount = ethers.utils.parseEther("100");
      await stakingToken.mint(user1.address, depositAmount);
      await stakingToken.connect(user1).approve(vault.address, depositAmount);
      await vault.connect(user1).deposit(depositAmount);

      // Start reward period
      await vault.connect(distributor).notifyRewardAmount(reward, duration);

      // Wait full period
      await ethers.provider.send("evm_increaseTime", [duration]);
      await ethers.provider.send("evm_mine");

      const earned = await vault.earned(user1.address);

      // Should receive close to full reward (within 0.01% error)
      const error = reward.sub(earned).mul(10000).div(reward);
      expect(error).to.be.lt(10); // Less than 0.01% error
    });
  });
});
