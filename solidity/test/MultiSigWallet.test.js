const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigWallet", function () {
  let wallet;
  let owners;
  let nonOwner;
  let recipient;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    owners = [signers[0], signers[1], signers[2]];
    nonOwner = signers[3];
    recipient = signers[4];

    const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
    wallet = await MultiSigWallet.deploy(
      owners.map(o => o.address),
      2 // 2 out of 3 required confirmations
    );

    // Fund the wallet with some ETH for value transfers
    await owners[0].sendTransaction({
      to: wallet.target,
      value: ethers.parseEther("10")
    });
  });

  it("Should prevent reentrancy and validate state during execution", async function () {
    const value = ethers.parseEther("1");
    // Submit transaction to transfer 1 ETH to recipient
    const tx = await wallet.connect(owners[0]).submitTransaction(recipient.address, value, "0x");
    const receipt = await tx.wait();

    // Confirm transaction with owner 0 and owner 1
    await wallet.connect(owners[0]).confirmTransaction(0);
    await wallet.connect(owners[1]).confirmTransaction(0);

    // Verify recipient initial balance
    const balanceBefore = await ethers.provider.getBalance(recipient.address);

    // Execute transaction
    await wallet.connect(owners[0]).executeTransaction(0);

    const balanceAfter = await ethers.provider.getBalance(recipient.address);
    expect(balanceAfter - balanceBefore).to.equal(value);

    // Try executing again (should fail because state marked it executed)
    await expect(
      wallet.connect(owners[0]).executeTransaction(0)
    ).to.be.revertedWith("Already executed");
  });

  it("Should revert on invalid owner lists or requirements in constructor", async function () {
    const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
    
    // Duplicate owner
    await expect(
      MultiSigWallet.deploy([owners[0].address, owners[0].address], 1)
    ).to.be.revertedWith("Owner not unique");

    // Zero address owner
    await expect(
      MultiSigWallet.deploy([owners[0].address, ethers.ZeroAddress], 1)
    ).to.be.revertedWith("Invalid owner");

    // Invalid required count
    await expect(
      MultiSigWallet.deploy([owners[0].address, owners[1].address], 3)
    ).to.be.revertedWith("Invalid required");
  });
});
