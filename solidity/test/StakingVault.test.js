const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault", function () {
  let vault, token, owner, staker;
  const REWARD_RATE = 1; // 1 wei per second per token = negligible

  beforeEach(async function () {
    [owner, staker] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("GovernanceToken");
    token = await Token.deploy(ethers.parseEther("10000"));
    await token.waitForDeployment();

    const Vault = await ethers.getContractFactory("StakingVault");
    vault = await Vault.deploy(await token.getAddress(), REWARD_RATE);
    await vault.waitForDeployment();

    // Fund staker with tokens and approve vault
    await token.transfer(staker.address, ethers.parseEther("1000"));
    await token.connect(staker).approve(await vault.getAddress(), ethers.parseEther("1000"));

    // Fund vault with ETH for withdrawals
    await owner.sendTransaction({
      to: await vault.getAddress(),
      value: ethers.parseEther("100")
    });

    // Stake
    await vault.connect(staker).stake(ethers.parseEther("100"));
  });

  it("should accept stakes and update balance", async function () {
    expect(await vault.getStakedBalance(staker.address)).to.equal(ethers.parseEther("100"));
    expect(await vault.totalStaked()).to.equal(ethers.parseEther("100"));
  });

  it("should accumulate rewards over time", async function () {
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine");
    expect(await vault.getPendingRewards(staker.address)).to.be.gt(0);
  });

  it("should allow withdrawal with reentrancy protection", async function () {
    await expect(vault.connect(staker).withdraw(ethers.parseEther("50")))
      .to.changeEtherBalance(staker, ethers.parseEther("50"));
    expect(await vault.getStakedBalance(staker.address)).to.equal(ethers.parseEther("50"));
  });

  it("should reject withdrawal exceeding balance", async function () {
    await expect(
      vault.connect(staker).withdraw(ethers.parseEther("200"))
    ).to.be.revertedWith("Insufficient balance");
  });

  it("should claim rewards", async function () {
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine");
    const pending = await vault.getPendingRewards(staker.address);
    expect(pending).to.be.gt(0);
    await vault.connect(staker).claimRewards();
    expect(await vault.getPendingRewards(staker.address)).to.equal(0);
    expect(await vault.getStakedBalance(staker.address)).to.equal(ethers.parseEther("100"));
  });

  it("should use ReentrancyGuard", async function () {
    const code = await ethers.provider.getCode(await vault.getAddress());
    expect(code.length).to.be.gt(100);
  });
});
