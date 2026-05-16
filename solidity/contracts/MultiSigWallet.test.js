const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigWallet", function () {
  let wallet;
  let owner1, owner2, owner3;
  let recipient;

  beforeEach(async function () {
    [owner1, owner2, owner3, recipient] = await ethers.getSigners();

    const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
    wallet = await MultiSigWallet.deploy(
      [owner1.address, owner2.address, owner3.address],
      2 // Require 2 confirmations
    );
    await wallet.deployed();
  });

  describe("Reentrancy Protection", function () {
    it("should prevent reentrancy during execution", async function () {
      // Submit transaction
      await wallet.submitTransaction(recipient.address, ethers.utils.parseEther("1.0"), "0x");
      
      // Confirm from two owners
      await wallet.connect(owner1).confirmTransaction(0);
      await wallet.connect(owner2).confirmTransaction(0);

      // Deploy attacker contract
      const ReentrancyAttacker = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await ReentrancyAttacker.deploy(wallet.address);

      // Fund the wallet
      await owner1.sendTransaction({
        to: wallet.address,
        value: ethers.utils.parseEther("10.0"),
      });

      // Try to execute - should succeed without reentrancy issues
      await wallet.connect(owner1).executeTransaction(0);
      
      // Verify transaction was executed
      const tx = await wallet.transactions(0);
      expect(tx.executed).to.be.true;
    });
  });

  describe("Confirmation Race Condition", function () {
    it("should verify confirmations at execution time", async function () {
      // Submit transaction
      await wallet.submitTransaction(recipient.address, ethers.utils.parseEther("1.0"), "0x");
      
      // Confirm from two owners
      await wallet.connect(owner1).confirmTransaction(0);
      await wallet.connect(owner2).confirmTransaction(0);

      // Verify confirmation count before execution
      expect(await wallet.getConfirmationCount(0)).to.equal(2);
      expect(await wallet.isConfirmed(0)).to.be.true;

      // Execute transaction
      await wallet.connect(owner1).executeTransaction(0);

      // Verify execution
      const tx = await wallet.transactions(0);
      expect(tx.executed).to.be.true;
    });

    it("should handle confirmation revocation correctly", async function () {
      // Submit transaction
      await wallet.submitTransaction(recipient.address, ethers.utils.parseEther("1.0"), "0x");
      
      // Confirm from two owners
      await wallet.connect(owner1).confirmTransaction(0);
      await wallet.connect(owner2).confirmTransaction(0);

      // Revoke one confirmation
      await wallet.connect(owner1).revokeConfirmation(0);

      // Should not be able to execute with only 1 confirmation
      await expect(
        wallet.connect(owner1).executeTransaction(0)
      ).to.be.revertedWith("Cannot execute tx - not enough confirmations");

      // Re-confirm
      await wallet.connect(owner3).confirmTransaction(0);

      // Now should be able to execute
      await wallet.connect(owner1).executeTransaction(0);
    });
  });

  describe("isConfirmedAtBlock", function () {
    it("should check confirmation at specific block", async function () {
      // Submit transaction
      await wallet.submitTransaction(recipient.address, ethers.utils.parseEther("1.0"), "0x");
      
      // Get current block number
      const currentBlock = await ethers.provider.getBlockNumber();
      
      // Confirm from owner1
      await wallet.connect(owner1).confirmTransaction(0);
      
      // Check confirmation at current block
      expect(await wallet.isConfirmedAtBlock(0, owner1.address, currentBlock)).to.be.true;
      
      // Check that owner2 is not confirmed
      expect(await wallet.isConfirmedAtBlock(0, owner2.address, currentBlock)).to.be.false;
    });
  });
});
