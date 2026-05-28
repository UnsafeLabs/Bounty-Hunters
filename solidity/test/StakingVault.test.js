const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault", function () {
  let vault, token, owner, attacker;
  const REWARD_RATE = ethers.parseEther("0.01");

  beforeEach(async function () {
    [owner, attacker] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy(ethers.parseEther("10000"));
    await token.waitForDeployment();

    const StakingVault = await ethers.getContractFactory("StakingVault");
    vault = await StakingVault.deploy(await token.getAddress(), REWARD_RATE);
    await vault.waitForDeployment();

    // Fund vault with ETH for withdrawals
    await owner.sendTransaction({
      to: await vault.getAddress(),
      value: ethers.parseEther("100")
    });

    // Approve tokens
    await token.approve(await vault.getAddress(), ethers.parseEther("10000"));
  });

  it("should allow staking", async function () {
    await vault.stake(ethers.parseEther("100"));
    expect(await vault.getStakedBalance(owner.address)).to.equal(ethers.parseEther("100"));
  });

  it("should allow normal withdrawal", async function () {
    await vault.stake(ethers.parseEther("100"));
    await vault.withdraw(ethers.parseEther("50"));
    expect(await vault.getStakedBalance(owner.address)).to.equal(ethers.parseEther("50"));
  });

  it("should prevent reentrancy via malicious contract", async function () {
    const MaliciousStaker = await ethers.getContractFactory("MaliciousStaker");
    const malicious = await MaliciousStaker.deploy(await vault.getAddress(), await token.getAddress());
    await malicious.waitForDeployment();

    // Fund malicious contract with ETH and tokens
    await owner.sendTransaction({ to: await malicious.getAddress(), value: ethers.parseEther("10") });
    await token.transfer(await malicious.getAddress(), ethers.parseEther("100"));

    // Stake through malicious contract
    await malicious.approveAndStake(ethers.parseEther("100"));

    // Attempt reentrancy — should revert
    await expect(malicious.attack()).to.be.reverted;
  });

  it("should allow claimRewards", async function () {
    await vault.stake(ethers.parseEther("100"));
    // Advance time to accumulate rewards
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);
    await vault.claimRewards();
  });
});
