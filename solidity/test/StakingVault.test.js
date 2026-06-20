const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault", function () {
  let stakingVault, stakingToken, owner, user;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    stakingToken = await MockToken.deploy("Staking Token", "STK");
    await stakingToken.deployed();

    const StakingVault = await ethers.getContractFactory("StakingVault");
    stakingVault = await StakingVault.deploy(stakingToken.address, ethers.utils.parseEther("0.01"));
    await stakingVault.deployed();
  });

  describe("Staking", function () {
    it("should allow users to stake tokens", async function () {
      const amount = ethers.utils.parseEther("100");
      await stakingToken.mint(user.address, amount);
      await stakingToken.connect(user).approve(stakingVault.address, amount);

      await stakingVault.connect(user).stake(amount);

      expect(await stakingVault.balances(user.address)).to.equal(amount);
      expect(await stakingVault.totalStaked()).to.equal(amount);
    });

    it("should not allow staking 0 tokens", async function () {
      await expect(stakingVault.connect(user).stake(0)).to.be.revertedWith("Cannot stake 0");
    });
  });

  describe("Withdrawal", function () {
    it("should allow users to withdraw staked tokens", async function () {
      const amount = ethers.utils.parseEther("100");
      await stakingToken.mint(user.address, amount);
      await stakingToken.connect(user).approve(stakingVault.address, amount);
      await stakingVault.connect(user).stake(amount);

      await owner.sendTransaction({ to: stakingVault.address, value: ethers.utils.parseEther("200") });

      const balanceBefore = await ethers.provider.getBalance(user.address);
      await stakingVault.connect(user).withdraw(amount);
      const balanceAfter = await ethers.provider.getBalance(user.address);

      expect(balanceAfter.sub(balanceBefore)).to.be.gt(0);
      expect(await stakingVault.balances(user.address)).to.equal(0);
    });

    it("should revert if insufficient balance", async function () {
      await expect(stakingVault.connect(user).withdraw(100)).to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Rewards", function () {
    it("should accrue rewards over time", async function () {
      const amount = ethers.utils.parseEther("100");
      await stakingToken.mint(user.address, amount);
      await stakingToken.connect(user).approve(stakingVault.address, amount);
      await stakingVault.connect(user).stake(amount);

      await owner.sendTransaction({ to: stakingVault.address, value: ethers.utils.parseEther("1") });

      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");

      const pendingRewards = await stakingVault.getPendingRewards(user.address);
      expect(pendingRewards).to.be.gt(0);
    });

    it("should allow claiming rewards", async function () {
      const amount = ethers.utils.parseEther("100");
      await stakingToken.mint(user.address, amount);
      await stakingToken.connect(user).approve(stakingVault.address, amount);
      await stakingVault.connect(user).stake(amount);

      await owner.sendTransaction({ to: stakingVault.address, value: ethers.utils.parseEther("500") });

      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");

      const pendingRewards = await stakingVault.getPendingRewards(user.address);
      expect(pendingRewards).to.be.gt(0);

      await stakingVault.connect(user).claimRewards();
      expect(await stakingVault.rewards(user.address)).to.equal(0);
    });

    it("should revert if no rewards", async function () {
      await expect(stakingVault.connect(user).claimRewards()).to.be.revertedWith("No rewards");
    });
  });

  describe("Reentrancy Protection", function () {
    it("should revert when attacker attempts reentrancy on withdraw", async function () {
      const stakeAmount = ethers.utils.parseEther("100");
      const attackAmount = ethers.utils.parseEther("1");

      // Deploy attacker contract
      const Attacker = await ethers.getContractFactory("ReentrantAttacker");
      const attacker = await Attacker.deploy(stakingVault.address);
      await attacker.deployed();

      // Fund attacker contract with tokens and ETH for gas
      await stakingToken.mint(attacker.address, stakeAmount);
      await owner.sendTransaction({ to: attacker.address, value: ethers.utils.parseEther("2") });

      // Deploy an ERC20 from the attacker contract's perspective — we need the attacker to hold tokens
      // The attacker contract will stake then try to re-enter
      await attacker.stake(stakeAmount);

      // Send ETH to vault so it can pay withdrawals and rewards
      await owner.sendTransaction({ to: stakingVault.address, value: ethers.utils.parseEther("500") });

      // Advance time for rewards
      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");

      // Attack should revert due to nonReentrant
      await expect(attacker.attackWithdraw(attackAmount)).to.be.reverted;
    });

    it("should revert when attacker attempts reentrancy on claimRewards", async function () {
      const stakeAmount = ethers.utils.parseEther("100");

      const Attacker = await ethers.getContractFactory("ReentrantAttacker");
      const attacker = await Attacker.deploy(stakingVault.address);
      await attacker.deployed();

      await stakingToken.mint(attacker.address, stakeAmount);
      await owner.sendTransaction({ to: attacker.address, value: ethers.utils.parseEther("2") });

      await attacker.stake(stakeAmount);

      await owner.sendTransaction({ to: stakingVault.address, value: ethers.utils.parseEther("500") });

      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");

      await expect(attacker.attackClaimRewards()).to.be.reverted;
    });
  });
});
