const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

describe("MultiSigWallet", function () {
  async function deployWallet(required = 2) {
    const [ownerA, ownerB, ownerC, recipient] = await ethers.getSigners();
    const Wallet = await ethers.getContractFactory("MultiSigWallet");
    const wallet = await Wallet.deploy([ownerA.address, ownerB.address, ownerC.address], required);

    return { ownerA, ownerB, ownerC, recipient, wallet };
  }

  async function submit(wallet, signer, to, value = 0n, data = "0x") {
    const tx = await wallet.connect(signer).submitTransaction(to, value, data);
    const receipt = await tx.wait();

    return receipt.logs.find((log) => log.fragment && log.fragment.name === "Submitted").args.txId;
  }

  it("rejects zero-address targets and calldata sent to non-contract targets", async function () {
    const { ownerA, recipient, wallet } = await deployWallet();

    await assert.rejects(
      wallet.connect(ownerA).submitTransaction(ethers.ZeroAddress, 0, "0x"),
      /Invalid target/
    );

    await assert.rejects(
      wallet.connect(ownerA).submitTransaction(recipient.address, 0, "0x1234"),
      /Target not contract/
    );
  });

  it("preserves submit, confirm, execute, and revoke flows", async function () {
    const { ownerA, ownerB, recipient, wallet } = await deployWallet();
    await ownerA.sendTransaction({ to: await wallet.getAddress(), value: ethers.parseEther("1") });

    const transferValue = ethers.parseEther("0.1");
    const txId = await submit(wallet, ownerA, recipient.address, transferValue);
    await wallet.connect(ownerA).confirmTransaction(txId);
    await wallet.connect(ownerB).confirmTransaction(txId);

    await wallet.connect(ownerA).executeTransaction(txId);

    assert.equal((await wallet.transactions(txId)).executed, true);

    const revokeTxId = await submit(wallet, ownerA, recipient.address, 1n);
    await wallet.connect(ownerA).confirmTransaction(revokeTxId);
    assert.equal(await wallet.getConfirmationCount(revokeTxId), 1n);

    await wallet.connect(ownerA).revokeConfirmation(revokeTxId);
    assert.equal(await wallet.getConfirmationCount(revokeTxId), 0n);
    assert.equal(await wallet.confirmations(revokeTxId, ownerA.address), false);
  });

  it("tracks confirmations by block and rejects front-run revocations before execution", async function () {
    const { ownerA, ownerB, recipient, wallet } = await deployWallet();
    const txId = await submit(wallet, ownerA, recipient.address, 0);

    const confirmTx = await wallet.connect(ownerA).confirmTransaction(txId);
    const confirmReceipt = await confirmTx.wait();
    await wallet.connect(ownerB).confirmTransaction(txId);

    assert.equal(await wallet.isConfirmedAtBlock(txId, ownerA.address, confirmReceipt.blockNumber), true);

    const revokeTx = await wallet.connect(ownerB).revokeConfirmation(txId);
    const revokeReceipt = await revokeTx.wait();

    assert.equal(await wallet.isConfirmedAtBlock(txId, ownerB.address, revokeReceipt.blockNumber), false);
    assert.equal(await wallet.getConfirmationCountAtBlock(txId, revokeReceipt.blockNumber), 1n);

    await assert.rejects(
      wallet.connect(ownerA).executeTransaction(txId),
      /Not enough confirmations/
    );
  });

  it("reverts execution if a callback revokes a required confirmation", async function () {
    const [ownerA] = await ethers.getSigners();
    const Target = await ethers.getContractFactory("MultiSigRevokeTarget");
    const target = await Target.deploy();

    const Wallet = await ethers.getContractFactory("MultiSigWallet");
    const wallet = await Wallet.deploy([ownerA.address, await target.getAddress()], 2);
    await target.setWallet(await wallet.getAddress());

    const data = target.interface.encodeFunctionData("revokeDuringExecution");
    const txId = await submit(wallet, ownerA, await target.getAddress(), 0n, data);
    await target.setTransactionId(txId);

    await wallet.connect(ownerA).confirmTransaction(txId);
    await target.confirmTransaction(txId);

    await assert.rejects(
      wallet.connect(ownerA).executeTransaction(txId),
      /Confirmations revoked/
    );

    assert.equal((await wallet.transactions(txId)).executed, false);
    assert.equal(await wallet.confirmations(txId, await target.getAddress()), true);
    assert.equal(await target.callbackReached(), false);
  });

  it("keeps simple ETH transfer execution under 100,000 gas", async function () {
    const { ownerA, ownerB, recipient, wallet } = await deployWallet();
    await ownerA.sendTransaction({ to: await wallet.getAddress(), value: ethers.parseEther("1") });

    const txId = await submit(wallet, ownerA, recipient.address, ethers.parseEther("0.01"));
    await wallet.connect(ownerA).confirmTransaction(txId);
    await wallet.connect(ownerB).confirmTransaction(txId);

    const receipt = await (await wallet.connect(ownerA).executeTransaction(txId)).wait();

    assert.ok(receipt.gasUsed < 100000n, `gas used ${receipt.gasUsed}`);
  });
});
