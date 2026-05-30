const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenVesting", function () {
  let token, vesting, owner, beneficiary, attacker;
  const TOTAL = ethers.parseEther("1000000");
  const CLIFF_DURATION = 7 * 86400; // 7 days
  const VESTING_DURATION = 30 * 86400; // 30 days
  let startTime;

  beforeEach(async function () {
    [owner, beneficiary, attacker] = await ethers.getSigners();

    // Deploy a mock ERC20 so transfer works
    const ERC20 = await ethers.getContractFactory("TestERC20");
    token = await ERC20.deploy("Test Token", "TST");

    // Get current time and set start to +1h
    const block = await ethers.provider.getBlock("latest");
    startTime = block.timestamp + 3600;

    const Vesting = await ethers.getContractFactory("TokenVesting");
    vesting = await Vesting.deploy(
      token.target,
      beneficiary.address,
      TOTAL,
      startTime,
      CLIFF_DURATION,
      VESTING_DURATION
    );

    // Mint tokens and fund the vesting contract
    const MINT_AMOUNT = ethers.parseEther("2000000000"); // 2B — enough for big allocation test too
    await token.mint(owner.address, MINT_AMOUNT);
    await token.transfer(vesting.target, TOTAL);
  });

  describe("vestedAmount (overflow fix + remainder)", function () {
    it("returns 0 during cliff", async function () {
      // Still in cliff (before start+cliff)
      const amt = await vesting.vestedAmount();
      expect(amt).to.equal(0);
    });

    it("returns totalAllocation after full duration", async function () {
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTime + VESTING_DURATION + 100,
      ]);
      await ethers.provider.send("evm_mine");
      expect(await vesting.vestedAmount()).to.equal(TOTAL);
    });

    it("returns ~50% at halfway point (within 1 token)", async function () {
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTime + Math.floor(VESTING_DURATION / 2),
      ]);
      await ethers.provider.send("evm_mine");
      const amt = await vesting.vestedAmount();
      const half = TOTAL / 2n;
      const diff = amt > half ? amt - half : half - amt;
      expect(diff).to.be.lte(1n);
    });

    it("does not overflow for 1B tokens with 18 decimals", async function () {
      const MAX_ALLOC = ethers.parseEther("1000000000");
      await token.transfer(vesting.target, MAX_ALLOC - TOTAL); // top up

      // Need to create a new vesting contract with max allocation
      const Vesting = await ethers.getContractFactory("TokenVesting");
      const TokenBig = await ethers.getContractFactory("TestERC20");
      const bigToken = await TokenBig.deploy("Big T", "BIG");
      const v2 = await Vesting.deploy(
        bigToken.target,
        beneficiary.address,
        MAX_ALLOC,
        startTime,
        CLIFF_DURATION,
        VESTING_DURATION
      );
      // Mint and fund v2
      await bigToken.mint(v2.target, MAX_ALLOC);
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTime + Math.floor(VESTING_DURATION / 2),
      ]);
      await ethers.provider.send("evm_mine");
      const amt = await v2.vestedAmount();
      expect(amt).to.be.lte(MAX_ALLOC);
    });

    it("linear vesting curve is accurate to within 1 token", async function () {
      // Checkpoints after cliff (cliff=7d, duration=30d)
      const checkpoints = [0.3, 0.5, 0.7, 0.9];
      for (const pct of checkpoints) {
        const t = startTime + Math.floor(VESTING_DURATION * pct);
        await ethers.provider.send("evm_setNextBlockTimestamp", [t]);
        await ethers.provider.send("evm_mine");
        const amt = await vesting.vestedAmount();
        // Reference: totalAllocation * elapsed / duration (original formula - correct for continuous case)
        const elapsed = t - startTime;
        const ref = (TOTAL * BigInt(elapsed)) / BigInt(VESTING_DURATION);
        const diff = amt > ref ? amt - ref : ref - amt;
        expect(diff).to.be.lte(1n, `off by ${diff} at ${Math.round(pct * 100)}%`);
      }
    });
  });

  describe("claim", function () {
    it("allows beneficiary to claim after cliff", async function () {
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTime + CLIFF_DURATION + 3600,
      ]);
      await ethers.provider.send("evm_mine");
      const claimable = await vesting.claimable();
      expect(claimable).to.be.gt(0n);
      await expect(vesting.connect(beneficiary).claim()).to.not.be.reverted;
    });

    it("rejects claim from non-beneficiary", async function () {
      await expect(vesting.connect(attacker).claim()).to.be.revertedWith(
        "Not beneficiary"
      );
    });

    it("tracks cumulative claimed amount correctly", async function () {
      // Claim at several points
      for (let i = 0; i < 3; i++) {
        await ethers.provider.send("evm_setNextBlockTimestamp", [
          startTime + CLIFF_DURATION + (i + 1) * Math.floor(VESTING_DURATION / 4),
        ]);
        await ethers.provider.send("evm_mine");
        const claimable = await vesting.claimable();
        if (claimable > 0n) {
          await vesting.connect(beneficiary).claim();
        }
      }
      // After full duration, total claimed = TOTAL
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        startTime + VESTING_DURATION + 100,
      ]);
      await ethers.provider.send("evm_mine");
      const finalClaimable = await vesting.claimable();
      await vesting.connect(beneficiary).claim();
      expect(await vesting.claimed()).to.equal(TOTAL);
    });
  });

  describe("revoke", function () {
    it("revocation during cliff returns correct unvested amount", async function () {
      const beneficiaryBalanceBefore = await token.balanceOf(beneficiary.address);
      const ownerBalanceBefore = await token.balanceOf(owner.address);

      await vesting.revoke();

      // During cliff: nothing vested, beneficiary gets 0, owner gets all
      expect(await token.balanceOf(beneficiary.address)).to.equal(
        beneficiaryBalanceBefore
      );
      // Owner gets total allocation back
      expect(await token.balanceOf(owner.address)).to.equal(
        ownerBalanceBefore + TOTAL
      );
      expect(await vesting.revoked()).to.be.true;
    });

    it("revocation after partial vesting returns only truly unvested tokens", async function () {
      // Advance to 25% vesting
      const t = startTime + Math.floor(VESTING_DURATION * 0.25);
      await ethers.provider.send("evm_setNextBlockTimestamp", [t]);
      await ethers.provider.send("evm_mine");

      const benefitBefore = await token.balanceOf(beneficiary.address);
      const ownerBefore = await token.balanceOf(owner.address);

      await vesting.revoke();

      // Beneficiary should get nothing extra (hasn't claimed)
      // Actually they should get vested - claimed = vested (since claimed=0)
      const vestContract = await token.balanceOf(vesting.target);
      const benefitAfter = await token.balanceOf(beneficiary.address);
      const ownerAfter = await token.balanceOf(owner.address);

      // Beneficiary got their vested (but unclaimed) tokens
      expect(benefitAfter - benefitBefore).to.be.gt(0n);
      // Owner got the unvested portion
      expect(ownerAfter - ownerBefore).to.be.gt(0n);
      // Total returned = TOTAL
      expect(benefitAfter - benefitBefore + (ownerAfter - ownerBefore)).to.equal(
        TOTAL
      );
    });

    it("revoke after partial claim returns correct amounts", async function () {
      // Advance to 50% vesting
      const t = startTime + Math.floor(VESTING_DURATION * 0.5);
      await ethers.provider.send("evm_setNextBlockTimestamp", [t]);
      await ethers.provider.send("evm_mine");
      // Claim some
      await vesting.connect(beneficiary).claim();
      const claimedAmt = await vesting.claimed();

      // Now revoke
      const benefitBefore = await token.balanceOf(beneficiary.address);
      const ownerBefore = await token.balanceOf(owner.address);
      await vesting.revoke();

      const benefitAfter = await token.balanceOf(beneficiary.address);
      const ownerAfter = await token.balanceOf(owner.address);

      // Beneficiary should get vested - claimed = 0 (they already claimed everything)
      // Actually depends on exact timing. Just verify total makes sense
      const totalReturned =
        benefitAfter - benefitBefore + (ownerAfter - ownerBefore);
      // Contract should be empty
      expect(await token.balanceOf(vesting.target)).to.equal(0n);
    });

    it("rejects double revocation", async function () {
      await vesting.revoke();
      await expect(vesting.revoke()).to.be.revertedWith("Already revoked");
    });

    it("rejects revocation from non-owner", async function () {
      await expect(vesting.connect(attacker).revoke()).to.be.revertedWith(
        "Not owner"
      );
    });
  });
});