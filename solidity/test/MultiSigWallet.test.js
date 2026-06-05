const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigWallet", function () {
  async function deployWallet(owners, required) {
    const Wallet = await ethers.getContractFactory("MultiSigWallet");
    const wallet = await Wallet.deploy(owners, required);
    await wallet.deployed();
    return wallet;
  }

  async function submitAndConfirm(wallet, submitter, confirmers, to, value, data = "0x") {
    const submitTx = await wallet.connect(submitter).submitTransaction(to, value, data);
    const receipt = await submitTx.wait();
    const submitted = receipt.events.find((event) => event.event === "Submitted");
    const txId = submitted.args.txId;

    for (const confirmer of confirmers) {
      await wallet.connect(confirmer).confirmTransaction(txId);
    }

    return txId;
  }

  it("keeps the submit, confirm, revoke, execute flow working", async function () {
    const [ownerA, ownerB, ownerC, recipient] = await ethers.getSigners();
    const wallet = await deployWallet([ownerA.address, ownerB.address, ownerC.address], 2);

    await ownerA.sendTransaction({ to: wallet.address, value: ethers.utils.parseEther("1") });

    const amount = ethers.utils.parseEther("0.05");
    const txId = await submitAndConfirm(wallet, ownerA, [ownerA, ownerB], recipient.address, amount);

    expect(await wallet.getConfirmationCount(txId)).to.equal(2);

    await wallet.connect(ownerB).revokeConfirmation(txId);
    expect(await wallet.getConfirmationCount(txId)).to.equal(1);

    await wallet.connect(ownerC).confirmTransaction(txId);
    expect(await wallet.getConfirmationCount(txId)).to.equal(2);

    const recipientBefore = await ethers.provider.getBalance(recipient.address);
    await expect(wallet.connect(ownerA).executeTransaction(txId)).to.emit(wallet, "Executed").withArgs(txId);
    const recipientAfter = await ethers.provider.getBalance(recipient.address);

    expect(recipientAfter.sub(recipientBefore)).to.equal(amount);
    expect((await wallet.transactions(txId)).executed).to.equal(true);
  });

  it("blocks callback-time confirmation revocation during execution", async function () {
    const [owner] = await ethers.getSigners();

    const Revoker = await ethers.getContractFactory("MultiSigCallbackRevoker");
    const revoker = await Revoker.deploy();
    await revoker.deployed();

    const wallet = await deployWallet([owner.address, revoker.address], 2);
    await owner.sendTransaction({ to: wallet.address, value: ethers.utils.parseEther("1") });

    const txId = await submitAndConfirm(
      wallet,
      owner,
      [owner],
      revoker.address,
      ethers.utils.parseEther("0.01")
    );

    await revoker.configure(wallet.address, txId);
    await revoker.confirm(txId);
    await revoker.setAttemptRevoke(true);

    await expect(wallet.connect(owner).executeTransaction(txId)).to.emit(wallet, "Executed").withArgs(txId);

    expect(await revoker.revokeSucceeded()).to.equal(false);
    expect(await wallet.getConfirmationCount(txId)).to.equal(2);
    expect((await wallet.transactions(txId)).executed).to.equal(true);
  });

  it("uses block-level confirmation checks to reject revoked confirmations", async function () {
    const [ownerA, ownerB, recipient] = await ethers.getSigners();
    const wallet = await deployWallet([ownerA.address, ownerB.address], 2);

    await ownerA.sendTransaction({ to: wallet.address, value: ethers.utils.parseEther("1") });
    const txId = await submitAndConfirm(wallet, ownerA, [ownerA, ownerB], recipient.address, ethers.utils.parseEther("0.01"));

    const confirmedBlock = await ethers.provider.getBlockNumber();
    expect(await wallet["isConfirmedAtBlock(uint256,address,uint256)"](txId, ownerB.address, confirmedBlock)).to.equal(true);
    expect(await wallet["isConfirmedAtBlock(uint256,uint256)"](txId, confirmedBlock)).to.equal(true);

    await wallet.connect(ownerB).revokeConfirmation(txId);
    const revokedBlock = await ethers.provider.getBlockNumber();

    expect(await wallet["isConfirmedAtBlock(uint256,address,uint256)"](txId, ownerB.address, revokedBlock)).to.equal(false);
    expect(await wallet["isConfirmedAtBlock(uint256,uint256)"](txId, revokedBlock)).to.equal(false);
    await expect(wallet.connect(ownerA).executeTransaction(txId)).to.be.revertedWith("Not enough confirmations");
  });

  it("rejects zero-address transaction targets", async function () {
    const [ownerA, ownerB] = await ethers.getSigners();
    const wallet = await deployWallet([ownerA.address, ownerB.address], 2);

    await expect(
      wallet.connect(ownerA).submitTransaction(ethers.constants.AddressZero, 0, "0x")
    ).to.be.revertedWith("Zero address target");
  });

  it("rejects calldata sent to accounts without code", async function () {
    const [ownerA, ownerB, recipient] = await ethers.getSigners();
    const wallet = await deployWallet([ownerA.address, ownerB.address], 2);

    await expect(
      wallet.connect(ownerA).submitTransaction(recipient.address, 0, "0x1234")
    ).to.be.revertedWith("Target has no code");
  });

  it("keeps simple ETH transfer execution under 100,000 gas", async function () {
    const [ownerA, ownerB, recipient] = await ethers.getSigners();
    const wallet = await deployWallet([ownerA.address, ownerB.address], 2);

    await ownerA.sendTransaction({ to: wallet.address, value: ethers.utils.parseEther("1") });
    const txId = await submitAndConfirm(wallet, ownerA, [ownerA, ownerB], recipient.address, ethers.utils.parseEther("0.01"));

    const execution = await wallet.connect(ownerA).executeTransaction(txId);
    const receipt = await execution.wait();

    expect(receipt.gasUsed.toNumber()).to.be.lessThanOrEqual(100000);
  });
});
