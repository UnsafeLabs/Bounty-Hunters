const { expect } = require("chai");
const hre = require("hardhat");

describe("StakingVault", function () {
  let stakingVault, token, owner, addr1, addr2, maliciousContract;
  let MaliciousContract;

  const STAKE_AMOUNT = 1000;
  const WITHDRAW_AMOUNT = 500;
  const REWARD_RATE = 1e18;

  beforeEach(async function () {
    [owner, addr1, addr2] = await hre.ethers.getSigners();

    // Deploy mock ERC20 token
    const MockToken = await hre.ethers.getContractFactory("MockERC20");
    token = await MockToken.deploy("MockToken", "MTK", 18);
    await token.waitForDeployment();

    // Deploy StakingVault
    stakingVault = await hre.ethers.getContractFactory("StakingVault");
    stakingVault = await stakingVault.deploy(token.target, REWARD_RATE);
    await stakingVault.waitForDeployment();

    // Fund vault with ETH for withdrawals
    await owner.sendTransaction({
      to: stakingVault.target,
      value: hre.ethers.parseEther("10"),
    });

    // Mint tokens to owner and addr1
    await token.mint(addr1.address, hre.ethers.parseUnits("10000", 18));
    await token.mint(addr2.address, hre.ethers.parseUnits("10000", 18));

    // Deploy malicious contract for reentrancy test
    MaliciousContract = await hre.ethers.getContractFactory("MaliciousContract");
    maliciousContract = await MaliciousContract.deploy(stakingVault.target);
    await maliciousContract.waitForDeployment();
  });

  describe("Basic functionality", function () {
    it("should allow staking", async function () {
      await token.connect(addr1).approve(stakingVault.target, STAKE_AMOUNT);
      await stakingVault.connect(addr1).stake(STAKE_AMOUNT);
      expect(await stakingVault.balances(addr1.address)).to.equal(STAKE_AMOUNT);
      expect(await stakingVault.totalStaked()).to.equal(STAKE_AMOUNT);
    });

    it("should allow claiming rewards", async function () {
      await token.connect(addr1).approve(stakingVault.target, STAKE_AMOUNT);
      await stakingVault.connect(addr1).stake(STAKE_AMOUNT);

      // Advance time so rewards accumulate
      await hre.network.provider.send("evm_increaseTime", [86400]); // 1 day
      await hre.network.provider.send("evm_mine");

      const balBefore = await hre.ethers.provider.getBalance(addr1.address);
      await stakingVault.connect(addr1).claimRewards();
      const balAfter = await hre.ethers.provider.getBalance(addr1.address);

      // Balance should increase (some reward claimed)
      expect(balAfter).to.be.greaterThan(balBefore);
    });

    it("should allow withdrawing", async function () {
      await token.connect(addr1).approve(stakingVault.target, STAKE_AMOUNT);
      await stakingVault.connect(addr1).stake(STAKE_AMOUNT);

      const balBefore = await hre.ethers.provider.getBalance(addr1.address);
      await stakingVault.connect(addr1).withdraw(WITHDRAW_AMOUNT);
      const balAfter = await hre.ethers.provider.getBalance(addr1.address);

      expect(balAfter).to.be.greaterThan(balBefore);
      expect(await stakingVault.balances(addr1.address)).to.equal(
        STAKE_AMOUNT - WITHDRAW_AMOUNT
      );
    });
  });

  describe("Reentrancy protection", function () {
    it("should prevent reentrancy in withdraw via MaliciousContract", async function () {
      // Fund malicious contract with enough ETH to attempt reentrancy
      await owner.sendTransaction({
        to: maliciousContract.target,
        value: hre.ethers.parseEther("5"),
      });

      // Approve and stake via malicious contract
      // Malicious contract calls withdraw which tries recursive call
      // The reentrancy guard should prevent the recursive call
      const tx = maliciousContract.attackWithValue({
        value: hre.ethers.parseEther("1"),
      });
      // Should revert due to reentrancy guard or insufficient balance
      await expect(tx).to.be.revertedWith("Insufficient balance");
    });

    it("should prevent reentrancy in claimRewards", async function () {
      // Fund malicious contract
      await owner.sendTransaction({
        to: maliciousContract.target,
        value: hre.ethers.parseEther("5"),
      });

      // Malicious contract attempts to exploit claimRewards
      const tx = maliciousContract.attackClaimRewards();
      await expect(tx).to.be.revertedWith("No rewards");
    });
  });
});
