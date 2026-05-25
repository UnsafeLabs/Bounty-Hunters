const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault", function () {
  async function deploy() {
    const [owner, user] = await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20");
    const vault = await ethers.deployContract("StakingVault", [
      await token.getAddress(),
      1n,
    ]);
    await token.transfer(user.address, ethers.parseEther("100"));
    return { owner, user, token, vault };
  }

  it("withdraw updates balance before external transfer", async function () {
    const { owner, user, token, vault } = await deploy();
    const amount = ethers.parseEther("10");
    await token.connect(user).approve(await vault.getAddress(), amount);
    await vault.connect(user).stake(amount);
    await owner.sendTransaction({
      to: await vault.getAddress(),
      value: amount,
    });

    const before = await vault.getStakedBalance(user.address);
    expect(before).to.equal(amount);

    await expect(vault.connect(user).withdraw(amount)).to.emit(
      vault,
      "Withdrawn"
    );
    expect(await vault.getStakedBalance(user.address)).to.equal(0n);
  });

  it("reentrancy attack on withdraw reverts", async function () {
    const { owner, user, token, vault } = await deploy();
    const amount = ethers.parseEther("5");
    await token.connect(user).approve(await vault.getAddress(), amount);
    await vault.connect(user).stake(amount);
    await owner.sendTransaction({
      to: await vault.getAddress(),
      value: amount,
    });

    const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
    const attacker = await Attacker.deploy(
      await vault.getAddress(),
      await token.getAddress()
    );
    const attackerAddr = await attacker.getAddress();
    await token.connect(user).approve(attackerAddr, amount);
    await attacker.connect(user).fundAndStake(amount);
    await owner.sendTransaction({
      to: await vault.getAddress(),
      value: amount,
    });
    await expect(attacker.attack()).to.be.reverted;
  });

  it("claimRewards clears rewards before transfer", async function () {
    const { owner, user, token, vault } = await deploy();
    const amount = ethers.parseEther("1");
    await token.connect(user).approve(await vault.getAddress(), amount);
    await vault.connect(user).stake(amount);
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);

    const pending = await vault.getPendingRewards(user.address);
    expect(pending).to.be.gt(0n);
    await owner.sendTransaction({
      to: await vault.getAddress(),
      value: ethers.parseEther("100"),
    });

    await expect(vault.connect(user).claimRewards()).to.emit(
      vault,
      "RewardClaimed"
    );
    expect(await vault.rewards(user.address)).to.equal(0n);
  });
});
