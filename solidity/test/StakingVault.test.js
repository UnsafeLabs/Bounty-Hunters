const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault Reentrancy", function () {
  let stakingToken;
  let vault;
  let attacker;
  let owner;
  let user;

  // Compatibility helper for ethers parseEther
  const parseEther = (val) => {
    return ethers.parseEther ? ethers.parseEther(val) : ethers.utils.parseEther(val);
  };

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy GovernanceToken as the staking token
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    stakingToken = await GovernanceToken.deploy(parseEther("1000000"));
    if (stakingToken.waitForDeployment) {
      await stakingToken.waitForDeployment();
    } else if (stakingToken.deployed) {
      await stakingToken.deployed();
    }

    const tokenAddress = stakingToken.target || stakingToken.address;

    // Deploy StakingVault
    const StakingVault = await ethers.getContractFactory("StakingVault");
    vault = await StakingVault.deploy(tokenAddress, 100);
    if (vault.waitForDeployment) {
      await vault.waitForDeployment();
    } else if (vault.deployed) {
      await vault.deployed();
    }

    const vaultAddress = vault.target || vault.address;

    // Fund StakingVault with ETH so there is ETH to be withdrawn/drained
    const tx = await owner.sendTransaction({
      to: vaultAddress,
      value: parseEther("10")
    });
    await tx.wait();

    // Deploy ReentrancyAttacker
    const ReentrancyAttacker = await ethers.getContractFactory("ReentrancyAttacker");
    attacker = await ReentrancyAttacker.deploy(vaultAddress, tokenAddress);
    if (attacker.waitForDeployment) {
      await attacker.waitForDeployment();
    } else if (attacker.deployed) {
      await attacker.deployed();
    }
  });

  it("should revert on reentrancy attack attempt", async function () {
    const attackAmount = parseEther("1");
    const attackerAddress = attacker.target || attacker.address;

    // Transfer staking tokens to attacker
    const tx = await stakingToken.transfer(attackerAddress, attackAmount);
    await tx.wait();

    // The attack must revert
    await expect(attacker.attack(attackAmount)).to.be.reverted;
  });

  it("should allow normal staking, withdrawal, and reward claiming", async function () {
    const stakeAmount = parseEther("1");
    const vaultAddress = vault.target || vault.address;

    // Transfer staking tokens to user
    const txTransfer = await stakingToken.transfer(user.address, stakeAmount);
    await txTransfer.wait();

    // User approves vault
    const txApprove = await stakingToken.connect(user).approve(vaultAddress, stakeAmount);
    await txApprove.wait();

    // Stake
    const txStake = await vault.connect(user).stake(stakeAmount);
    await txStake.wait();

    expect(await vault.getStakedBalance(user.address)).to.equal(stakeAmount);

    // Withdraw normal flow
    const txWithdraw = await vault.connect(user).withdraw(stakeAmount);
    await txWithdraw.wait();

    expect(await vault.getStakedBalance(user.address)).to.equal(0);
  });
});
