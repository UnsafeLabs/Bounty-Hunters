const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

async function mine(provider, seconds) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

describe("StakingVault", function () {
  async function fixture() {
    const [owner, user, attacker] = await ethers.getSigners();
    const rewardRate = ethers.parseEther("0.001");

    const Token = await ethers.getContractFactory("GovernanceToken");
    const token = await Token.deploy(ethers.parseEther("1000000"));
    await token.waitForDeployment();

    const Vault = await ethers.getContractFactory("StakingVault");
    const vault = await Vault.deploy(await token.getAddress(), rewardRate);
    await vault.waitForDeployment();
    const vaultAddress = await vault.getAddress();

    await owner.sendTransaction({ to: vaultAddress, value: ethers.parseEther("100") });

    const stakeAmount = ethers.parseEther("10");
    await token.transfer(user.address, stakeAmount);
    await token.connect(user).approve(vaultAddress, stakeAmount);

    const Attacker = await ethers.getContractFactory("StakingVaultReentrantAttacker");
    const attackerContract = await Attacker.connect(attacker).deploy(
      vaultAddress,
      await token.getAddress()
    );
    await attackerContract.waitForDeployment();
    const attackerContractAddress = await attackerContract.getAddress();

    await token.transfer(attackerContractAddress, stakeAmount);

    return { owner, user, attacker, token, vault, attackerContract, stakeAmount };
  }

  it("preserves normal staking, withdrawal, and reward claim flows", async function () {
    const { user, vault, stakeAmount } = await fixture();

    await vault.connect(user).stake(stakeAmount);
    assert.equal(await vault.balances(user.address), stakeAmount);
    assert.equal(await vault.totalStaked(), stakeAmount);

    await mine(ethers.provider, 100);
    const pendingReward = await vault.getPendingRewards(user.address);
    assert.equal(pendingReward, ethers.parseEther("1"));

    const claimReceipt = await (await vault.connect(user).claimRewards()).wait();
    assert.equal(await vault.rewards(user.address), 0n);

    const withdrawReceipt = await (await vault.connect(user).withdraw(ethers.parseEther("4"))).wait();

    assert.equal(await vault.balances(user.address), ethers.parseEther("6"));
    assert.equal(await vault.totalStaked(), ethers.parseEther("6"));
    assert.ok(claimReceipt.gasUsed < 80000n, `claim gas used ${claimReceipt.gasUsed}`);
    assert.ok(withdrawReceipt.gasUsed < 90000n, `withdraw gas used ${withdrawReceipt.gasUsed}`);
  });

  it("reverts recursive withdrawal attempts without changing vault accounting", async function () {
    const { vault, attackerContract, stakeAmount } = await fixture();
    const attackerAddress = await attackerContract.getAddress();

    await attackerContract.stake(stakeAmount);

    await assert.rejects(
      attackerContract.attackWithdraw(ethers.parseEther("1")),
      /Transfer failed|ReentrancyGuardReentrantCall/
    );

    assert.equal(await vault.balances(attackerAddress), stakeAmount);
    assert.equal(await vault.totalStaked(), stakeAmount);
    assert.equal(await ethers.provider.getBalance(attackerAddress), 0n);
    assert.equal(await attackerContract.reentryCount(), 0n);
  });

  it("reverts recursive reward claims without paying rewards twice", async function () {
    const { vault, attackerContract, stakeAmount } = await fixture();
    const attackerAddress = await attackerContract.getAddress();

    await attackerContract.stake(stakeAmount);
    await mine(ethers.provider, 100);
    const pendingReward = await vault.getPendingRewards(attackerAddress);

    await assert.rejects(
      attackerContract.attackClaimRewards(),
      /Transfer failed|ReentrancyGuardReentrantCall/
    );

    assert.equal(await vault.rewards(attackerAddress), 0n);
    assert.ok(await vault.getPendingRewards(attackerAddress) >= pendingReward);
    assert.equal(await ethers.provider.getBalance(attackerAddress), 0n);
    assert.equal(await attackerContract.reentryCount(), 0n);
  });
});
