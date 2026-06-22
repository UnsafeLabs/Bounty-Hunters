const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YieldVault", function () {
  let vault, stakingToken, rewardToken;
  let owner, user1, user2;
  const PRECISION = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock ERC20 tokens
    const ERC20 = await ethers.getContractFactory("MockERC20");
    stakingToken = await ERC20.deploy("Staking Token", "STK", ethers.parseEther("10000"));
    rewardToken = await ERC20.deploy("Reward Token", "RWD", ethers.parseEther("10000"));
    await stakingToken.waitForDeployment();
    await rewardToken.waitForDeployment();

    // Deploy YieldVault — owner becomes rewardDistributor
    const YieldVault = await ethers.getContractFactory("YieldVault");
    vault = await YieldVault.deploy(await stakingToken.getAddress(), await rewardToken.getAddress());
    await vault.waitForDeployment();

    // Transfer tokens to users
    await stakingToken.transfer(user1.address, ethers.parseEther("1000"));
    await stakingToken.transfer(user2.address, ethers.parseEther("1000"));

    // Approve vault to spend user tokens
    await stakingToken.connect(user1).approve(await vault.getAddress(), ethers.parseEther("1000"));
    await stakingToken.connect(user2).approve(await vault.getAddress(), ethers.parseEther("1000"));

    // Owner approves reward tokens for the vault
    await rewardToken.approve(await vault.getAddress(), ethers.parseEther("10000"));
  });

  describe("Reward distribution during period", function () {
    it("should accrue rewards correctly during the reward period", async function () {
      await vault.connect(user1).deposit(ethers.parseEther("100"));

      // Owner (distributor) notifies 1000 reward tokens over 1000 seconds
      await vault.notifyRewardAmount(ethers.parseEther("1000"), 1000);

      // Fast forward 500 seconds
      await ethers.provider.send("evm_increaseTime", [500]);
      await ethers.provider.send("evm_mine");

      // User1 should have earned ~500 reward tokens (500s * 1 reward/sec)
      const earned1 = await vault.earned(user1.address);
      expect(earned1).to.be.closeTo(ethers.parseEther("500"), ethers.parseEther("1"));
    });

    it("should allow claim during reward period", async function () {
      await vault.connect(user1).deposit(ethers.parseEther("100"));
      await vault.notifyRewardAmount(ethers.parseEther("1000"), 1000);

      await ethers.provider.send("evm_increaseTime", [500]);
      await ethers.provider.send("evm_mine");

      const earned = await vault.earned(user1.address);

      await vault.connect(user1).claimReward();
    });
  });

  describe("Phantom reward prevention after period expiry", function () {
    it("should NOT accrue additional rewards after period ends", async function () {
      await vault.connect(user1).deposit(ethers.parseEther("100"));
      await vault.notifyRewardAmount(ethers.parseEther("1000"), 100);

      // Fast forward past period finish (200 seconds)
      await ethers.provider.send("evm_increaseTime", [200]);
      await ethers.provider.send("evm_mine");

      // Record earned amount after period end
      const earnedAfterEnd = await vault.earned(user1.address);

      // Fast forward another 1000 seconds (well past period end)
      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine");

      // Earned should be the SAME — no phantom rewards
      const earnedAfterMoreTime = await vault.earned(user1.address);
      expect(earnedAfterMoreTime).to.equal(earnedAfterEnd);
    });

    it("should return zero additional earned for new depositors after period ends", async function () {
      await vault.notifyRewardAmount(ethers.parseEther("1000"), 100);

      // Fast forward past period finish
      await ethers.provider.send("evm_increaseTime", [200]);
      await ethers.provider.send("evm_mine");

      // User1 deposits AFTER reward period ended
      await vault.connect(user1).deposit(ethers.parseEther("100"));
      const earned = await vault.earned(user1.address);
      expect(earned).to.equal(0);
    });

    it("should have rewardPerTokenStored frozen after period ends", async function () {
      await vault.connect(user1).deposit(ethers.parseEther("100"));
      await vault.notifyRewardAmount(ethers.parseEther("1000"), 100);

      await ethers.provider.send("evm_increaseTime", [200]);
      await ethers.provider.send("evm_mine");

      const rptAfter = await vault.rewardPerToken();

      await ethers.provider.send("evm_increaseTime", [500]);
      await ethers.provider.send("evm_mine");

      const rptLater = await vault.rewardPerToken();
      expect(rptLater).to.equal(rptAfter);
    });
  });

  describe("Access control", function () {
    it("should allow only rewardDistributor to call notifyRewardAmount", async function () {
      await expect(
        vault.connect(user1).notifyRewardAmount(1000, 100)
      ).to.be.revertedWith("Not authorized");
    });

    it("should allow distributor (owner) to call notifyRewardAmount", async function () {
      await vault.notifyRewardAmount(ethers.parseEther("1000"), 100);
      const periodFinish = await vault.periodFinish();
      expect(periodFinish).to.be.gt(0);
    });
  });

  describe("Precision", function () {
    it("should have less than 0.01% error for small reward amounts", async function () {
      // Odd reward amount not evenly divisible by duration
      const reward = ethers.parseEther("1007");
      const duration = 7;

      await vault.connect(user1).deposit(ethers.parseEther("100"));
      await vault.notifyRewardAmount(reward, duration);

      await ethers.provider.send("evm_increaseTime", [duration]);
      await ethers.provider.send("evm_mine");

      const earned = await vault.earned(user1.address);

      // user1 has all stake, so earned ≈ reward
      const diff = earned > reward ? earned - reward : reward - earned;
      const maxError = (reward * 1n) / 10000n; // 0.01%
      expect(diff).to.be.lte(maxError);
    });
  });

  describe("Deposit and withdrawal flows", function () {
    it("should handle deposit, withdraw, and claim cycle", async function () {
      await vault.connect(user1).deposit(ethers.parseEther("500"));
      expect(await vault.balanceOf(user1.address)).to.equal(ethers.parseEther("500"));

      await vault.notifyRewardAmount(ethers.parseEther("500"), 500);

      await ethers.provider.send("evm_increaseTime", [200]);
      await ethers.provider.send("evm_mine");

      // Withdraw half
      await vault.connect(user1).withdraw(ethers.parseEther("250"));
      expect(await vault.balanceOf(user1.address)).to.equal(ethers.parseEther("250"));

      // Claim rewards earned so far
      await vault.connect(user1).claimReward();

      // Fast forward to end of period
      await ethers.provider.send("evm_increaseTime", [300]);
      await ethers.provider.send("evm_mine");

      // Should have remaining rewards for remaining 300s with 250 tokens (all staked)
      const remaining = await vault.earned(user1.address);
      // Expected: ~300 tokens (300s * 250/250 * 1 token/sec = 300)
      expect(remaining).to.be.closeTo(ethers.parseEther("300"), ethers.parseEther("10"));
    });

    it("should reject zero deposits", async function () {
      await expect(vault.connect(user1).deposit(0)).to.be.revertedWith("Cannot deposit 0");
    });

    it("should reject zero withdrawals", async function () {
      await expect(vault.connect(user1).withdraw(0)).to.be.revertedWith("Cannot withdraw 0");
    });
  });
});
