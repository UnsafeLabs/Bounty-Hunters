const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault Reentrancy Protection", function () {
  let stakingToken;
  let stakingVault;
  let owner, attacker, user1;

  beforeEach(async function () {
    [owner, attacker, user1] = await ethers.getSigners();

    // Deploy a mock ERC20 token
    const MockToken = await ethers.getContractFactory("MockERC20");
    stakingToken = await MockToken.deploy("Stake Token", "STK", ethers.parseEther("1000000"));
    await stakingToken.waitForDeployment();

    // Deploy StakingVault
    const StakingVault = await ethers.getContractFactory("StakingVault");
    stakingVault = await StakingVault.deploy(
      await stakingToken.getAddress(),
      100 // rewardRate
    );
    await stakingVault.waitForDeployment();

    // Fund the vault with ETH for withdrawals
    await owner.sendTransaction({
      to: await stakingVault.getAddress(),
      value: ethers.parseEther("10")
    });

    // Mint tokens and approve
    await stakingToken.mint(user1.address, ethers.parseEther("1000"));
    await stakingToken.connect(user1).approve(
      await stakingVault.getAddress(),
      ethers.parseEther("1000")
    );
  });

  describe("Normal staking flow", function () {
    it("should allow staking and withdrawing", async function () {
      await stakingVault.connect(user1).stake(ethers.parseEther("100"));
      expect(await stakingVault.getStakedBalance(user1.address)).to.equal(
        ethers.parseEther("100")
      );

      await stakingVault.connect(user1).withdraw(ethers.parseEther("50"));
      expect(await stakingVault.getStakedBalance(user1.address)).to.equal(
        ethers.parseEther("50")
      );
    });

    it("should allow claiming rewards", async function () {
      await stakingVault.connect(user1).stake(ethers.parseEther("100"));

      // Advance time to accrue rewards
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine");

      const pending = await stakingVault.getPendingRewards(user1.address);
      expect(pending).to.be.gt(0);

      await stakingVault.connect(user1).claimRewards();
    });
  });

  describe("Reentrancy attack protection", function () {
    it("should prevent reentrancy in withdraw", async function () {
      // Deploy malicious contract
      const MaliciousContract = await ethers.getContractFactory("MaliciousReentrancyAttacker");
      const malicious = await MaliciousContract.deploy(
        await stakingVault.getAddress(),
        await stakingToken.getAddress()
      );
      await malicious.waitForDeployment();

      // Fund the attacker
      await stakingToken.mint(await malicious.getAddress(), ethers.parseEther("100"));
      await malicious.stake();

      // Attempt reentrancy attack — should revert
      await expect(malicious.attackWithdraw()).to.be.revertedWith("ReentrancyGuard: reentrant call");
    });

    it("should prevent reentrancy in claimRewards", async function () {
      // Deploy malicious contract
      const MaliciousContract = await ethers.getContractFactory("MaliciousReentrancyAttacker");
      const malicious = await MaliciousContract.deploy(
        await stakingVault.getAddress(),
        await stakingToken.getAddress()
      );
      await malicious.waitForDeployment();

      // Fund the attacker
      await stakingToken.mint(await malicious.getAddress(), ethers.parseEther("100"));
      await malicious.stake();

      // Advance time to accrue rewards
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine");

      // Attempt reentrancy via claimRewards — should revert
      await expect(malicious.attackClaimRewards()).to.be.revertedWith("ReentrancyGuard: reentrant call");
    });
  });
});
