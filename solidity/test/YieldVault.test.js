const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("YieldVault", function () {
  let vault, stakingToken, rewardToken, owner, user1, user2;

  const REWARD_AMOUNT = ethers.parseEther("1000");
  const DURATION = 7 * 24 * 60 * 60;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    stakingToken = await MockERC20.deploy("Stake", "STK", ethers.parseEther("100000"));
    rewardToken = await MockERC20.deploy("Reward", "RWD", ethers.parseEther("100000"));

    const YieldVault = await ethers.getContractFactory("YieldVault");
    vault = await YieldVault.deploy(await stakingToken.getAddress(), await rewardToken.getAddress());

    await stakingToken.approve(await vault.getAddress(), ethers.parseEther("100000"));
    await stakingToken.connect(user1).approve(await vault.getAddress(), ethers.parseEther("100000"));
    await stakingToken.connect(user2).approve(await vault.getAddress(), ethers.parseEther("100000"));

    await rewardToken.transfer(await vault.getAddress(), REWARD_AMOUNT);
    await vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);
  });

  describe("Phantom reward accrual after period end", function () {
    it("should not accrue rewards after periodFinish", async function () {
      await stakingToken.transfer(user1.address, ethers.parseEther("100"));
      await stakingToken.connect(user1).deposit(ethers.parseEther("100"));

      await time.increase(DURATION);

      const earnedAtExpiry = await vault.earned(user1.address);

      await time.increase(DURATION);

      const earnedAfterExpiry = await vault.earned(user1.address);

      expect(earnedAfterExpiry).to.equal(earnedAtExpiry);
    });

    it("should cap lastUpdateTime at periodFinish in updateReward", async function () {
      await stakingToken.transfer(user1.address, ethers.parseEther("100"));
      await stakingToken.connect(user1).deposit(ethers.parseEther("100"));

      await time.increase(DURATION * 2);

      await vault.connect(user1).claimReward();

      const lastUpdate = await vault.lastUpdateTime();
      const periodEnd = await vault.periodFinish();

      expect(lastUpdate).to.be.lte(periodEnd);
    });

    it("rewardPerToken should plateau after period ends", async function () {
      await stakingToken.transfer(user1.address, ethers.parseEther("100"));
      await stakingToken.connect(user1).deposit(ethers.parseEther("100"));

      await time.increase(DURATION);

      const rptAtExpiry = await vault.rewardPerToken();

      await time.increase(DURATION);

      const rptAfterExpiry = await vault.rewardPerToken();

      expect(rptAfterExpiry).to.equal(rptAtExpiry);
    });

    it("claimReward should not distribute phantom rewards", async function () {
      await stakingToken.transfer(user1.address, ethers.parseEther("100"));
      await stakingToken.connect(user1).deposit(ethers.parseEther("100"));

      await time.increase(DURATION * 2);

      await vault.connect(user1).claimReward();

      const claimed = await rewardToken.balanceOf(user1.address);
      const expectedMax = REWARD_AMOUNT;

      expect(claimed).to.be.lte(expectedMax);
    });
  });

  describe("Normal reward accrual during active period", function () {
    it("should accrue rewards during the reward period", async function () {
      await stakingToken.transfer(user1.address, ethers.parseEther("100"));
      await stakingToken.connect(user1).deposit(ethers.parseEther("100"));

      await time.increase(DURATION / 2);

      const earned = await vault.earned(user1.address);
      expect(earned).to.be.gt(0);
    });

    it("should accrue full reward at period end", async function () {
      await stakingToken.transfer(user1.address, ethers.parseEther("100"));
      await stakingToken.connect(user1).deposit(ethers.parseEther("100"));

      await time.increase(DURATION);

      const earned = await vault.earned(user1.address);
      expect(earned).to.be.closeTo(REWARD_AMOUNT, ethers.parseEther("1"));
    });
  });

  describe("Access control on notifyRewardAmount", function () {
    it("should revert if non-distributor calls notifyRewardAmount", async function () {
      await expect(
        vault.connect(user1).notifyRewardAmount(REWARD_AMOUNT, DURATION)
      ).to.be.revertedWith("Only distributor");
    });

    it("should revert if duration is zero", async function () {
      await expect(
        vault.notifyRewardAmount(REWARD_AMOUNT, 0)
      ).to.be.revertedWith("Duration must be > 0");
    });
  });
});
