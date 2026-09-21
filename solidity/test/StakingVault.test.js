const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("StakingVault reentrancy hardening (#911)", function () {
  let vault, token, attacker, user;
  const rewardRate = ethers.parseUnits("1", 15);

  beforeEach(async function () {
    [user] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockERC20");
    token = await Mock.deploy();
    await token.waitForDeployment();

    const Vault = await ethers.getContractFactory("StakingVault");
    vault = await Vault.deploy(await token.getAddress(), rewardRate);
    await vault.waitForDeployment();

    await user.sendTransaction({
      to: await vault.getAddress(),
      value: ethers.parseEther("100"),
    });

    await token.mint(user.address, ethers.parseEther("1000"));
    await token.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);

    const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
    attacker = await Attacker.deploy(await vault.getAddress());
    await attacker.waitForDeployment();
  });

  it("allows normal stake and withdraw (happy path)", async function () {
    const amount = ethers.parseEther("10");
    await vault.connect(user).stake(amount);
    expect(await vault.balances(user.address)).to.equal(amount);

    const balBefore = await ethers.provider.getBalance(user.address);
    const tx = await vault.connect(user).withdraw(amount);
    const receipt = await tx.wait();
    const gas = receipt.gasUsed * receipt.gasPrice;
    const balAfter = await ethers.provider.getBalance(user.address);

    expect(await vault.balances(user.address)).to.equal(0n);
    expect(balAfter + gas - balBefore).to.equal(amount);
  });

  it("allows claimRewards after accrual (happy path)", async function () {
    const amount = ethers.parseEther("10");
    await vault.connect(user).stake(amount);
    await time.increase(10);
    const pending = await vault.getPendingRewards(user.address);
    expect(pending).to.be.gt(0n);

    await vault.connect(user).claimRewards();
    expect(await vault.rewards(user.address)).to.equal(0n);
  });

  it("blocks reentrancy on withdraw via malicious contract", async function () {
    const amount = ethers.parseEther("5");
    await token.connect(user).approve(await attacker.getAddress(), amount);
    await attacker.connect(user).stakeFrom(amount);
    expect(await vault.balances(await attacker.getAddress())).to.equal(amount);

    const vaultEthBefore = await ethers.provider.getBalance(await vault.getAddress());
    await attacker.arm(amount, false);

    await expect(attacker.attackWithdraw()).to.be.reverted;

    const vaultEthAfter = await ethers.provider.getBalance(await vault.getAddress());
    expect(vaultEthAfter).to.equal(vaultEthBefore);
  });

  it("blocks reentrancy on claimRewards via malicious contract", async function () {
    const amount = ethers.parseEther("5");
    await token.connect(user).approve(await attacker.getAddress(), amount);
    await attacker.connect(user).stakeFrom(amount);
    await time.increase(20);

    await attacker.arm(0, true);
    const vaultEthBefore = await ethers.provider.getBalance(await vault.getAddress());

    try {
      await attacker.attackClaim();
    } catch (_) {
      // full revert acceptable under nonReentrant
    }

    const vaultEthAfter = await ethers.provider.getBalance(await vault.getAddress());
    // At most one successful claim payout; never drained
    expect(vaultEthBefore - vaultEthAfter).to.be.lt(ethers.parseEther("50"));
    expect(await vault.rewards(await attacker.getAddress())).to.equal(0n);
  });
});
