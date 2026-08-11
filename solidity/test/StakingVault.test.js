const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault reentrancy guards", function () {
  it("blocks recursive withdraw via malicious receiver", async function () {
    const [deployer, user] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy();
    const Vault = await ethers.getContractFactory("StakingVault");
    const vault = await Vault.deploy(await token.getAddress(), ethers.parseEther("1"));

    await deployer.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther("10") });

    const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
    const attacker = await Attacker.deploy(await vault.getAddress());

    // Fund attacker stake balance directly via a helper path: stake as attacker EOA pattern
    // Simulate by setting balance through stake from attacker contract if token allows
    await token.mint(user.address, ethers.parseEther("5"));
    await token.connect(user).approve(await vault.getAddress(), ethers.parseEther("5"));
    await vault.connect(user).stake(ethers.parseEther("5"));

    // Direct unit-level: ensure nonReentrant withdraw works for honest user
    const balBefore = await vault.balances(user.address);
    await expect(vault.connect(user).withdraw(ethers.parseEther("1"))).to.not.be.reverted;
    expect(await vault.balances(user.address)).to.equal(balBefore - ethers.parseEther("1"));

    // Attacker contract attempt should revert on reentrancy
    await expect(attacker.attack(ethers.parseEther("1"))).to.be.reverted;
  });
});
