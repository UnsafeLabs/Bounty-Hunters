const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigWallet", function () {
  let wallet, owner1, owner2, owner3, attacker;
  const required = 2;

  beforeEach(async function () {
    [owner1, owner2, owner3, attacker] = await ethers.getSigners();

    const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
    wallet = await MultiSigWallet.deploy(
      [owner1.address, owner2.address, owner3.address],
      required
    );

    // Fund wallet
    await owner1.sendTransaction({
      to: await wallet.getAddress(),
      value: ethers.parseEther("10"),
    });
  });

  describe("submitTransaction", function () {
    it("should reject zero address", async function () {
      await expect(
        wallet.connect(owner1).submitTransaction(ethers.ZeroAddress, 0, "0x")
      ).to.be.revertedWith("Invalid address");
    });

    it("should submit a transaction", async function () {
      const tx = await wallet.connect(owner1).submitTransaction(
        owner2.address,
        ethers.parseEther("1"),
        "0x"
      );
      await expect(tx).to.emit(wallet, "Submitted").withArgs(0);
    });
  });

  describe("confirmTransaction", function () {
    beforeEach(async function () {
      await wallet.connect(owner1).submitTransaction(owner2.address, 0, "0x");
    });

    it("should confirm a transaction", async function () {
      const tx = await wallet.connect(owner1).confirmTransaction(0);
      await expect(tx).to.emit(wallet, "Confirmed").withArgs(0, owner1.address);
    });

    it("should not allow double confirmation", async function () {
      await wallet.connect(owner1).confirmTransaction(0);
      await expect(
        wallet.connect(owner1).confirmTransaction(0)
      ).to.be.revertedWith("Already confirmed");
    });
  });

  describe("revokeConfirmation", function () {
    beforeEach(async function () {
      await wallet.connect(owner1).submitTransaction(owner2.address, 0, "0x");
      await wallet.connect(owner1).confirmTransaction(0);
    });

    it("should revoke a confirmation", async function () {
      const tx = await wallet.connect(owner1).revokeConfirmation(0);
      await expect(tx).to.emit(wallet, "Revoked").withArgs(0, owner1.address);
    });

    it("should not allow non-confirmer to revoke", async function () {
      await expect(
        wallet.connect(owner2).revokeConfirmation(0)
      ).to.be.revertedWith("Not confirmed");
    });
  });

  describe("executeTransaction", function () {
    beforeEach(async function () {
      // Create a simple ETH transfer
      await wallet.connect(owner1).submitTransaction(owner3.address, ethers.parseEther("1"), "0x");
    });

    it("should execute with enough confirmations", async function () {
      await wallet.connect(owner1).confirmTransaction(0);
      await wallet.connect(owner2).confirmTransaction(0);

      const tx = await wallet.connect(owner1).executeTransaction(0);
      await expect(tx).to.emit(wallet, "Executed").withArgs(0);
    });

    it("should reject execution without enough confirmations", async function () {
      await wallet.connect(owner1).confirmTransaction(0);
      // Only 1 confirmation, need 2

      await expect(
        wallet.connect(owner1).executeTransaction(0)
      ).to.be.revertedWith("Not enough confirmations");
    });

    it("should prevent reentrancy via modifier", async function () {
      const ReentrancyAttack = await ethers.getContractFactory("ReentrancyAttack");
      const attack = await ReentrancyAttack.deploy(await wallet.getAddress());

      // Make tx 0 have enough confirmations first
      await wallet.connect(owner1).confirmTransaction(0);
      await wallet.connect(owner2).confirmTransaction(0);

      // Submit tx 1 — calls attack contract which will try re-entering executeTransaction(0)
      const calldata = attack.interface.encodeFunctionData("tryReenter", [0]);
      await wallet.connect(owner1).submitTransaction(await attack.getAddress(), 0, calldata);
      await wallet.connect(owner1).confirmTransaction(1);
      await wallet.connect(owner2).confirmTransaction(1);

      // The callback tries re-entering executeTransaction(0) — nonReentrant blocks it
      // Attack requires the reentry attempt to fail, proving the guard works
      await expect(
        wallet.connect(owner1).executeTransaction(1)
      ).to.emit(wallet, "Executed").withArgs(1);
    });
  });

  describe("isConfirmedAtBlock", function () {
    it("should return correct confirmation state at a given block", async function () {
      await wallet.connect(owner1).submitTransaction(owner2.address, 0, "0x");
      await wallet.connect(owner1).confirmTransaction(0);

      const blockBefore = await ethers.provider.getBlockNumber();

      await wallet.connect(owner2).confirmTransaction(0);

      // At blockBefore, only 1 confirmation — should not be confirmed
      expect(await wallet.isConfirmedAtBlock(0, blockBefore)).to.be.false;

      // At current block, 2 confirmations — should be confirmed
      expect(await wallet.isConfirmedAtBlock(0, await ethers.provider.getBlockNumber())).to.be.true;
    });
  });

  describe("Gas cost", function () {
    it("should execute a simple ETH transfer under 100k gas", async function () {
      await wallet.connect(owner1).submitTransaction(owner2.address, ethers.parseEther("1"), "0x");
      await wallet.connect(owner1).confirmTransaction(0);
      await wallet.connect(owner2).confirmTransaction(0);

      const tx = await wallet.connect(owner1).executeTransaction(0);
      const receipt = await tx.wait();
      expect(receipt.gasUsed).to.be.lessThan(100000n);
    });
  });
});
