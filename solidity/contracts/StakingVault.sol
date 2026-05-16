solidity
// File: solidity/test/StakingVault.test.js

const { ethers } = require("hardhat");
const { expect } = require("chai");
const { BigNumber } = ethers;

// -----------------------------------------------------------------------------
// Constants & Helpers
// -----------------------------------------------------------------------------
const ZERO = ethers.constants.Zero;
const MAX_UINT256 = ethers.constants.MaxUint256;
const AMOUNT = ethers.utils.parseEther("100");
const REWARD_RATE = ethers.utils.parseEther("1"); // 1 wei per second
const BASELINE_WITHDRAW_GAS = 80_000;
const BASELINE_CLAIM_GAS = 90_000;
const ALLOWED_GAS_OVERHEAD = 5_000;
const ONE_DAY = 86_400; // seconds

/**
 * @title StakingVault Test Suite
 * @notice Comprehensive production-grade tests covering:
 *         - Staking / Withdrawal / Reward claiming
 *         - Reentrancy protection (both withdraw & claimRewards)
 *         - Ownership and administrative functions
 *         - Token recovery
 *         - Gas cost constraints
 * @dev Uses Hardhat, Ethers v5, and Chai with structured hooks.
 */
describe("StakingVault - Production Quality Tests", function () {
  // ---------------------------------------------------------------------------
  // Signers & Contract References
  // ---------------------------------------------------------------------------
  /** @type {import("ethers").Signer} */
  let owner;

  /** @type {import("ethers").Signer} */
  let user;

  /** @type {import("ethers").Signer} */
  let attacker;

  /** @type {import("ethers").Contract} */
  let stakingToken;

  /** @type {import("ethers").Contract} */
  let vault;

  /** @type {import("ethers").Contract} */
  let malicious;

  // ---------------------------------------------------------------------------
  // Fixtures: Deploy and configure before each test
  // ---------------------------------------------------------------------------
  beforeEach(async function () {
    [owner, user, attacker] = await ethers.getSigners();

    // Deploy mock ERC20
    const Token = await ethers.getContractFactory("MockERC20");
    stakingToken = await Token.deploy("Stake", "STK");
    await stakingToken.deployed();

    // Mint tokens to users (10x amount)
    await stakingToken.mint(user.address, AMOUNT.mul(10));
    await stakingToken.mint(attacker.address, AMOUNT.mul(10));

    // Deploy StakingVault
    const Vault = await ethers.getContractFactory("StakingVault");
    vault = await Vault.deploy(stakingToken.address);
    await vault.deployed();

    // Set reward rate
    await vault.setRewardRate(REWARD_RATE);

    // Approve max spending for both users
    await stakingToken.connect(user).approve(vault.address, MAX_UINT256);
    await stakingToken.connect(attacker).approve(vault.address, MAX_UINT256);
  });

  // ===========================================================================
  // Staking
  // ===========================================================================
  describe("Staking", function () {
    /**
     * @notice Should update user balance and total supply after a single stake.
     */
    it("should update user balance and total supply on stake", async function () {
      await vault.connect(user).stake(AMOUNT);
      expect(await vault.balanceOf(user.address)).to.equal(AMOUNT);
      expect(await vault.totalSupply()).to.equal(AMOUNT);
    });

    /**
     * @notice Should revert when staking zero tokens.
     */
    it("should revert when staking zero", async function () {
      await expect(
        vault.connect(user).stake(ZERO)
      ).to.be.revertedWith("StakingVault__InvalidAmount");
    });

    /**
     * @notice Should revert when staking without allowance.
     */
    it("should revert when staking without approval", async function () {
      // Remove approval for user
      await stakingToken.connect(user).approve(vault.address, 0);
      await expect(
        vault.connect(user).stake(AMOUNT)
      ).to.be.reverted; // generic revert due to missing allowance
    });

    /**
     * @notice Should accrue rewards after time passes.
     */
    it("should accrue rewards after staking", async function () {
      await vault.connect(user).stake(AMOUNT);
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");
      const earnings = await vault.earned(user.address);
      expect(earnings).to.be.gt(0);
    });

    /**
     * @notice Should allow multiple stake operations.
     */
    it("should allow multiple stakes by the same user", async function () {
      await vault.connect(user).stake(AMOUNT);
      await vault.connect(user).stake(AMOUNT);
      expect(await vault.balanceOf(user.address)).to.equal(AMOUNT.mul(2));
    });
  });

  // ===========================================================================
  // Withdrawal & Reentrancy Protection
  // ===========================================================================
  describe("Withdrawal", function () {
    beforeEach(async function () {
      await vault.connect(user).stake(AMOUNT);
    });

    /**
     * @notice Should transfer ETH and reset balance on normal withdrawal.
     */
    it("should withdraw full stake and reset balance", async function () {
      const balanceBefore = await ethers.provider.getBalance(user.address);
      const tx = await vault.connect(user).withdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const balanceAfter = await ethers.provider.getBalance(user.address);

      expect(balanceAfter.add(gasUsed)).to.equal(balanceBefore.add(AMOUNT));
      expect(await vault.balanceOf(user.address)).to.equal(0);
      expect(await vault.totalSupply()).to.equal(0);
    });

    /**
     * @notice Should revert when user has no stake.
     */
    it("should revert when user has no stake", async function () {
      await vault.connect(user).withdraw();
      await expect(
        vault.connect(user).withdraw()
      ).to.be.revertedWith("StakingVault__NoStake");
    });

    /**
     * @notice Reentrancy attack on withdraw must revert with state unchanged.
     */
    it("should revert reentrancy attack in withdraw", async function () {
      // Deploy malicious contract
      const Malicious = await ethers.getContractFactory("MaliciousReentrancy");
      malicious = await Malicious.deploy(vault.address);
      await malicious.deployed();

      // Attackers stakes ETH
      await vault.connect(attacker).stake(AMOUNT);

      // Expect revert and state unchanged
      await expect(
        malicious.connect(attacker).attack()
      ).to.be.reverted;

      expect(await vault.balanceOf(attacker.address)).to.equal(AMOUNT);
      expect(await vault.totalSupply()).to.equal(AMOUNT);
    });

    /**
     * @notice Gas cost should not exceed baseline + allowed overhead.
     */
    it("should respect gas limit for withdrawal", async function () {
      const tx = await vault.connect(user).withdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.toNumber();
      expect(gasUsed).to.be.at.most(BASELINE_WITHDRAW_GAS + ALLOWED_GAS_OVERHEAD);
    });
  });

  // ===========================================================================
  // Claim Rewards & Reentrancy
  // ===========================================================================
  describe("Claim Rewards", function () {
    beforeEach(async function () {
      await vault.connect(user).stake(AMOUNT);
      // Advance time to accumulate rewards
      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");
    });

    /**
     * @notice Should transfer earned rewards to user.
     */
    it("should transfer earned rewards to user", async function () {
      const earnings = await vault.earned(user.address);
      expect(earnings).to.be.gt(0);

      const balanceBefore = await ethers.provider.getBalance(user.address);
      const tx = await vault.connect(user).claimRewards();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const balanceAfter = await ethers.provider.getBalance(user.address);

      expect(balanceAfter.add(gasUsed)).to.equal(balanceBefore.add(earnings));
    });

    /**
     * @notice Should revert when no rewards to claim.
     */
    it("should revert when no rewards", async function () {
      // Withdraw first to zero out rewards
      await vault.connect(user).withdraw();
      // Now claim should revert
      await expect(
        vault.connect(user).claimRewards()
      ).to.be.revertedWith("StakingVault__NoRewards");
    });

    /**
     * @notice Reentrancy attack on claimRewards must revert with state unchanged.
     */
    it("should revert reentrancy attack in claimRewards", async function () {
      // Deploy malicious contract (same one works for both functions)
      const Malicious = await ethers.getContractFactory("MaliciousReentrancy");
      malicious = await Malicious.deploy(vault.address);
      await malicious.deployed();

      const attackerStake = AMOUNT.div(2);
      await vault.connect(attacker).stake(attackerStake);
      // Move time for rewards
      await ethers.provider.send("evm_increaseTime", [50]);
      await ethers.provider.send("evm_mine");

      // Attack via claimRewards
      await expect(
        malicious.connect(attacker).attackClaimRewards()
      ).to.be.reverted;

      // State must remain intact: balance and rewards
      const earningsBefore = await vault.earned(attacker.address);
      expect(earningsBefore).to.be.gt(0);
      expect(await vault.balanceOf(attacker.address)).to.equal(attackerStake);
    });

    /**
     * @notice Gas cost should not exceed baseline + allowed overhead.
     */
    it("should respect gas limit for claimRewards", async function () {
      const tx = await vault.connect(user).claimRewards();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.toNumber();
      expect(gasUsed).to.be.at.most(BASELINE_CLAIM_GAS + ALLOWED_GAS_OVERHEAD);
    });
  });

  // ===========================================================================
  // Owner Functions
  // ===========================================================================
  describe("Owner Functions", function () {
    /**
     * @notice Only owner should be able to set reward rate.
     */
    it("should revert if non-owner sets reward rate", async function () {
      await expect(
        vault.connect(user).setRewardRate(REWARD_RATE.mul(2))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    /**
     * @notice Owner should be able to withdraw accidentally sent tokens.
     */
    it("should recover tokens sent to the vault", async function () {
      const recoverAmount = AMOUNT.div(2);
      // Send tokens directly to vault (not via stake)
      await stakingToken.transfer(vault.address, recoverAmount);

      const balanceBefore = await stakingToken.balanceOf(owner.address);
      await vault.recoverTokens(stakingToken.address, recoverAmount);
      const balanceAfter = await stakingToken.balanceOf(owner.address);
      expect(balanceAfter.sub(balanceBefore)).to.equal(recoverAmount);
    });
  });
});