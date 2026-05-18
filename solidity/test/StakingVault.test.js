const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault reentrancy protection", function () {
  async function deployFixture() {
    const [owner, user, attackerAccount] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Stake Token", "STK");

    const Vault = await ethers.getContractFactory("StakingVault");
    const rewardRate = ethers.parseEther("1");
    const vault = await Vault.deploy(await token.getAddress(), rewardRate);

    await owner.sendTransaction({
      to: await vault.getAddress(),
      value: ethers.parseEther("20"),
    });

    await token.mint(user.address, ethers.parseEther("10"));
    await token.mint(attackerAccount.address, ethers.parseEther("10"));

    return { owner, user, attackerAccount, token, vault };
  }

  it("keeps normal staking, withdrawal, and reward claims working", async function () {
    const { user, token, vault } = await deployFixture();
    const amount = ethers.parseEther("1");

    await token.connect(user).approve(await vault.getAddress(), amount);
    await vault.connect(user).stake(amount);
    expect(await vault.getStakedBalance(user.address)).to.equal(amount);

    await ethers.provider.send("evm_increaseTime", [10]);
    await ethers.provider.send("evm_mine");
    await expect(vault.connect(user).claimRewards()).to.emit(vault, "RewardClaimed");

    await expect(vault.connect(user).withdraw(amount)).to.emit(vault, "Withdrawn");
    expect(await vault.getStakedBalance(user.address)).to.equal(0n);
  });

  it("rejects recursive withdrawal attempts", async function () {
    const { attackerAccount, token, vault } = await deployFixture();
    const Attacker = await ethers.getContractFactory("StakingVaultReentrantAttacker");
    const attacker = await Attacker.connect(attackerAccount).deploy(
      await vault.getAddress(),
      await token.getAddress()
    );

    const amount = ethers.parseEther("1");
    await token.connect(attackerAccount).transfer(await attacker.getAddress(), amount);

    await expect(attacker.connect(attackerAccount).attackWithdraw(amount)).to.be.reverted;
    expect(await vault.getStakedBalance(await attacker.getAddress())).to.equal(0n);
  });

  it("rejects recursive reward claim attempts", async function () {
    const { attackerAccount, token, vault } = await deployFixture();
    const Attacker = await ethers.getContractFactory("StakingVaultReentrantAttacker");
    const attacker = await Attacker.connect(attackerAccount).deploy(
      await vault.getAddress(),
      await token.getAddress()
    );

    const amount = ethers.parseEther("1");
    await token.connect(attackerAccount).transfer(await attacker.getAddress(), amount);
    await attacker.connect(attackerAccount).stakeOnly(amount);

    await ethers.provider.send("evm_increaseTime", [10]);
    await ethers.provider.send("evm_mine");

    await expect(attacker.connect(attackerAccount).attackClaimRewards()).to.be.reverted;
  });
});
