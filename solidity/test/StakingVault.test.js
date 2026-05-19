const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault", function () {
  let StakingVault, vault, MockToken, token;
  let owner, user, attacker;

  beforeEach(async function () {
    [owner, user, attacker] = await ethers.getSigners();

    MockToken = await ethers.getContractFactory("ERC20Mock");
    token = await MockToken.deploy("Mock", "MCK", owner.address, ethers.utils.parseEther("1000"));
    await token.deployed();

    StakingVault = await ethers.getContractFactory("StakingVault");
    vault = await StakingVault.deploy(token.address, ethers.utils.parseEther("1"));
    await vault.deployed();

    // Send ETH to vault
    await owner.sendTransaction({ to: vault.address, value: ethers.utils.parseEther("10") });
  });

  it("should revert on reentrancy attack during withdraw", async function () {
    const Malicious = await ethers.getContractFactory("MaliciousContract");
    const malicious = await Malicious.deploy(vault.address);
    await malicious.deployed();

    await expect(malicious.attackWithdraw()).to.be.revertedWith("ReentrancyGuard: reentrant call");
  });

  it("should revert on reentrancy attack during claimRewards", async function () {
    const Malicious = await ethers.getContractFactory("MaliciousContract");
    const malicious = await Malicious.deploy(vault.address);
    await malicious.deployed();

    await expect(malicious.attackClaim()).to.be.revertedWith("ReentrancyGuard: reentrant call");
  });
});
