const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigWallet", function () {
  let wallet, owner1, owner2, owner3, nonOwner;
  let owners, required;

  beforeEach(async function () {
    [owner1, owner2, owner3, nonOwner] = await ethers.getSigners();
    owners = [owner1.address, owner2.address, owner3.address];
    required = 2;

    const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
    wallet = await MultiSigWallet.deploy(owners, required);
    await wallet.deployed();
  });

  describe("Submit Transaction", function () {
    it("should reject zero-address transactions", async function () {
      await expect(
        wallet.connect(owner1).submitTransaction(ethers.constants.AddressZero, 0, "0x")
      ).to.be.revertedWith("Zero address");
    });

    it("should reject non-owner submissions", async function () {
      await expect(
        wallet.connect(nonOwner).submitTransaction(owner1.address, 0, "0x")
      ).to.be.revertedWith("Not owner");
    });
  });

  describe("Confirmation Race Condition", function () {
    it("should track confirmation count correctly", async function () {
      await wallet.connect(owner1).submitTransaction(owner2.address, 0, "0x");
      const txId = 0;

      await wallet.connect(owner1).confirmTransaction(txId);
      expect(await wallet.getConfirmationCount(txId)).to.equal(1);

      await wallet.connect(owner2).confirmTransaction(txId);
      expect(await wallet.getConfirmationCount(txId)).to.equal(2);
    });

    it("should prevent execution after revocation", async function () {
      await wallet.connect(owner1).submitTransaction(owner2.address, 0, "0x");
      const txId = 0;

      await wallet.connect(owner1).confirmTransaction(txId);
      await wallet.connect(owner2).confirmTransaction(txId);

      // Revoke before execution
      await wallet.connect(owner1).revokeConfirmation(txId);
      expect(await wallet.getConfirmationCount(txId)).to.equal(1);

      // Should fail due to insufficient confirmations
      await expect(
        wallet.connect(owner2).executeTransaction(txId)
      ).to.be.revertedWith("Not enough confirmations");
    });
  });

  describe("Block-Level Confirmation Check", function () {
    it("should check confirmations at specific block", async function () {
      await wallet.connect(owner1).submitTransaction(owner2.address, 0, "0x");
      const txId = 0;

      await wallet.connect(owner1).confirmTransaction(txId);
      const block1 = await ethers.provider.getBlockNumber();

      await wallet.connect(owner2).confirmTransaction(txId);

      // Check at block 1 - should be false (only 1 confirmation)
      expect(await wallet.isConfirmedAtBlock(txId, block1)).to.equal(false);

      // Check at current block - should be true
      expect(await wallet.isConfirmedAtBlock(txId, await ethers.provider.getBlockNumber())).to.equal(true);
    });
  });
});
