const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault", function () {
  const rewardRate = ethers.parseEther("0.000001");
  const stakeAmount = ethers.parseEther("1");

  async function deployVaultFixture() {
    const [owner, user, attacker] = await ethers.getSigners();

    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    const token = await GovernanceToken.deploy(ethers.parseEther("1000000"));

    const StakingVault = await ethers.getContractFactory("StakingVault");
    const vault = await StakingVault.deploy(await token.getAddress(), rewardRate);

    await owner.sendTransaction({
      to: await vault.getAddress(),
      value: ethers.parseEther("100"),
    });

    await token.transfer(user.address, ethers.parseEther("100"));
    await token.transfer(attacker.address, ethers.parseEther("100"));

    return { owner, user, attacker, token, vault };
  }

  it("allows normal staking and withdrawal flows", async function () {
    const { user, token, vault } = await deployVaultFixture();

    await token.connect(user).approve(await vault.getAddress(), stakeAmount);
    await expect(vault.connect(user).stake(stakeAmount))
      .to.emit(vault, "Staked")
      .withArgs(user.address, stakeAmount);

    await expect(vault.connect(user).withdraw(stakeAmount))
      .to.emit(vault, "Withdrawn")
      .withArgs(user.address, stakeAmount);

    expect(await vault.getStakedBalance(user.address)).to.equal(0);
    expect(await vault.totalStaked()).to.equal(0);
  });

  it("allows normal reward claims", async function () {
    const { user, token, vault } = await deployVaultFixture();

    await token.connect(user).approve(await vault.getAddress(), stakeAmount);
    await vault.connect(user).stake(stakeAmount);
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine");

    const pendingReward = await vault.getPendingRewards(user.address);
    await expect(vault.connect(user).claimRewards())
      .to.emit(vault, "RewardClaimed")
      .withArgs(user.address, pendingReward);

    expect(await vault.rewards(user.address)).to.equal(0);
  });

  it("reverts recursive withdrawals from a malicious contract", async function () {
    const { attacker, token, vault } = await deployVaultFixture();

    const Attacker = await ethers.getContractFactory("MaliciousStakingVaultAttacker");
    const attackerContract = await Attacker.connect(attacker).deploy(
      await vault.getAddress(),
      await token.getAddress()
    );

    await token.connect(attacker).approve(await attackerContract.getAddress(), stakeAmount);
    await attackerContract.connect(attacker).stake(stakeAmount);

    await expect(
      attackerContract.connect(attacker).attackWithdraw(stakeAmount)
    ).to.be.reverted;

    expect(await vault.getStakedBalance(await attackerContract.getAddress())).to.equal(stakeAmount);
  });

  it("reverts recursive reward claims from a malicious contract", async function () {
    const { attacker, token, vault } = await deployVaultFixture();

    const Attacker = await ethers.getContractFactory("MaliciousStakingVaultAttacker");
    const attackerContract = await Attacker.connect(attacker).deploy(
      await vault.getAddress(),
      await token.getAddress()
    );

    await token.connect(attacker).approve(await attackerContract.getAddress(), stakeAmount);
    await attackerContract.connect(attacker).stake(stakeAmount);
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine");

    const pendingReward = await vault.getPendingRewards(await attackerContract.getAddress());
    await expect(
      attackerContract.connect(attacker).attackClaimRewards()
    ).to.be.reverted;

    expect(await vault.rewards(await attackerContract.getAddress())).to.equal(0);
    expect(await vault.getPendingRewards(await attackerContract.getAddress())).to.be.gte(pendingReward);
  });
});
