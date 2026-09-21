const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigWallet – race condition protection", function () {
  let wallet;
  let owner1, owner2, attacker, recipient;
  const requiredConfirmations = 2;

  beforeEach(async function () {
    [owner1, owner2, attacker, recipient] = await ethers.getSigners();

    // Deploy the MultiSigWallet with two owners (owner1 and owner2)
    const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
    wallet = await MultiSigWallet.deploy(
      [owner1.address, owner2.address],
      requiredConfirmations
    );
    await wallet.deployed();

    // Fund the wallet with 1 ether
    await owner1.sendTransaction({
      to: wallet.address,
      value: ethers.utils.parseEther("1.0"),
    });
  });

  it("should reject zero‑address submissions", async function () {
    await expect(
      wallet
        .connect(owner1)
        .submitTransaction(
          ethers.constants.AddressZero,
          0,
          "0x"
        )
    ).to.be.revertedWith("invalid destination address");
  });

  it("should execute a simple ETH transfer within gas limits", async function () {
    const txValue = ethers.utils.parseEther("0.1");

    await wallet
      .connect(owner1)
      .submitTransaction(recipient.address, txValue, "0x");

    const txId = 0;

    await wallet.connect(owner1).confirmTransaction(txId);
    await wallet.connect(owner2).confirmTransaction(txId);

    const receipt = await wallet
      .connect(owner1)
      .executeTransaction(txId);

    // Gas usage check (simple transfer should be well under 100k)
    const gasUsed = receipt.gasUsed;
    expect(gasUsed.toNumber()).to.be.lt(100000);

    // Verify recipient balance increased
    const bal = await ethers.provider.getBalance(recipient.address);
    expect(bal).to.equal(txValue);
  });

  it("should revert if a confirmation is revoked during execution callback", async function () {
    // Deploy a malicious contract that revokes its confirmation in fallback
    const Malicious = await ethers.getContractFactory("MaliciousCallback");
    const malicious = await Malicious.deploy(wallet.address);
    await malicious.deployed();

    // Submit a transaction that calls the malicious contract
    await wallet
      .connect(owner1)
      .submitTransaction(malicious.address, 0, "0x");

    const txId = 0;

    // Both owners confirm the transaction
    await wallet.connect(owner1).confirmTransaction(txId);
    await wallet.connect(owner2).confirmTransaction(txId);

    // The malicious contract will try to revoke the confirmation of owner2 during the call
    await expect(
      wallet.connect(owner1).executeTransaction(txId)
    ).to.be.revertedWith("confirmations revoked");
  });

  it("should prevent front‑running revocation before execution", async function () {
    // Submit a normal transaction
    await wallet
      .connect(owner1)
      .submitTransaction(recipient.address, 0, "0x");
    const txId = 0;

    // Owner1 confirms, Owner2 confirms
    await wallet.connect(owner1).confirmTransaction(txId);
    await wallet.connect(owner2).confirmTransaction(txId);

    // Owner2 revokes *just before* execution (simulating front‑run)
    await wallet.connect(owner2).revokeConfirmation(txId);

    // Execution should fail because confirmations are no longer sufficient
    await expect(
      wallet.connect(owner1).executeTransaction(txId)
    ).to.be.revertedWith("cannot execute tx");
  });
});
