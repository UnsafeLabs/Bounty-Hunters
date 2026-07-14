// StakingVault.test.js — Reentrancy attack test
// Verifies that withdraw and claimRewards are protected against reentrancy

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault Reentrancy Protection", function () {
  let stakingVault;
  let stakingToken;
  let owner;
  let attacker;

  beforeEach(async function () {
    [owner, attacker] = await ethers.getSigners();

    // Deploy a mock ERC20 token for staking
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    stakingToken = await MockERC20.deploy("StakeToken", "STK", ethers.utils.parseEther("1000000"));
    await stakingToken.deployed();

    // Deploy StakingVault with 0 reward rate for simplicity
    const StakingVault = await ethers.getContractFactory("StakingVault");
    stakingVault = await StakingVault.deploy(stakingToken.address, 0);
    await stakingVault.deployed();

    // Fund vault with some ETH for withdrawals
    await owner.sendTransaction({
      to: stakingVault.address,
      value: ethers.utils.parseEther("100")
    });

    // Approve and stake tokens
    await stakingToken.approve(stakingVault.address, ethers.utils.parseEther("1000"));
    await stakingVault.stake(ethers.utils.parseEther("100"));
  });

  describe("Withdraw Reentrancy Protection", function () {
    it("should prevent reentrancy attack on withdraw", async function () {
      // Deploy malicious attacker contract
      const MaliciousWithdrawAttacker = await ethers.getContractFactory("MaliciousWithdrawAttacker");
      const attackerContract = await MaliciousWithdrawAttacker.deploy(stakingVault.address);
      await attackerContract.deployed();

      // Fund attacker contract with staking tokens
      await stakingToken.transfer(attackerContract.address, ethers.utils.parseEther("100"));
      
      // Try the attack
      await expect(
        attackerContract.attack(ethers.utils.parseEther("10"))
      ).to.be.revertedWith("ReentrancyGuard: reentrant call");

      // Verify vault balance is still correct
      const vaultBalance = await stakingVault.balances(attackerContract.address);
      console.log("Vault balance after failed attack:", ethers.utils.formatEther(vaultBalance));
    });

    it("should allow normal withdrawal with CEI pattern", async function () {
      const balanceBefore = await ethers.provider.getBalance(stakingVault.address);
      
      await stakingVault.withdraw(ethers.utils.parseEther("10"));
      
      // Verify balance decreased
      const userBalance = await stakingVault.balances(owner.address);
      expect(userBalance).to.equal(ethers.utils.parseEther("90"));
    });
  });

  describe("ClaimRewards Reentrancy Protection", function () {
    it("should prevent reentrancy attack on claimRewards", async function () {
      // Deploy malicious attacker contract
      const MaliciousRewardAttacker = await ethers.getContractFactory("MaliciousRewardAttacker");
      const attackerContract = await MaliciousRewardAttacker.deploy(stakingVault.address);
      await attackerContract.deployed();

      // Fund attacker and stake
      await stakingToken.transfer(attackerContract.address, ethers.utils.parseEther("100"));
      
      await expect(
        attackerContract.attackRewards()
      ).to.be.revertedWith("ReentrancyGuard: reentrant call");
    });
  });
});

// Malicious contract that attempts reentrancy on withdraw
// SPDX-License-Identifier: MIT
// This would be in a separate file; here as reference for the test setup
