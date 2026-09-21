const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("MultiSigWallet confirmation race hardening (#916)", function () {
  let wallet, revoker;
  let owner1, owner2, owner3, recipient;

  async function deployWallet(owners, required) {
    const Factory = await ethers.getContractFactory("MultiSigWallet");
    const w = await Factory.deploy(owners, required);
    await w.waitForDeployment();
    return w;
  }

  beforeEach(async function () {
    [owner1, owner2, owner3, recipient] = await ethers.getSigners();

    const Revoker = await ethers.getContractFactory("CallbackRevoker");
    revoker = await Revoker.deploy();
    await revoker.waitForDeployment();

    wallet = await deployWallet(
      [owner1.address, owner2.address, await revoker.getAddress()],
      2
    );
    await revoker.setWallet(await wallet.getAddress());

    await owner1.sendTransaction({
      to: await wallet.getAddress(),
      value: ethers.parseEther("10"),
    });
  });

  it("happy path: submit, confirm, execute, revoke", async function () {
    const txId = await wallet
      .connect(owner1)
      .submitTransaction.staticCall(recipient.address, ethers.parseEther("1"), "0x");
    await wallet
      .connect(owner1)
      .submitTransaction(recipient.address, ethers.parseEther("1"), "0x");

    await wallet.connect(owner1).confirmTransaction(txId);
    await wallet.connect(owner2).confirmTransaction(txId);

    // Confirmations must be from a prior block for execute snapshot
    await network.provider.send("evm_mine");

    const before = await ethers.provider.getBalance(recipient.address);
    await expect(wallet.connect(owner1).executeTransaction(txId))
      .to.emit(wallet, "Executed")
      .withArgs(txId);
    const after = await ethers.provider.getBalance(recipient.address);
    expect(after - before).to.equal(ethers.parseEther("1"));

    // Fresh tx to exercise revoke
    const txId2 = await wallet
      .connect(owner1)
      .submitTransaction.staticCall(recipient.address, ethers.parseEther("0.5"), "0x");
    await wallet
      .connect(owner1)
      .submitTransaction(recipient.address, ethers.parseEther("0.5"), "0x");
    await wallet.connect(owner1).confirmTransaction(txId2);
    expect(await wallet.getConfirmationCount(txId2)).to.equal(1n);
    await wallet.connect(owner1).revokeConfirmation(txId2);
    expect(await wallet.getConfirmationCount(txId2)).to.equal(0n);
  });

  it("rejects zero-address submit", async function () {
    await expect(
      wallet.connect(owner1).submitTransaction(ethers.ZeroAddress, ethers.parseEther("1"), "0x")
    ).to.be.revertedWith("Zero address");
  });

  it("rejects calldata target with no code", async function () {
    await expect(
      wallet.connect(owner1).submitTransaction(recipient.address, 0, "0x1234")
    ).to.be.revertedWith("Target has no code");
  });

  it("reverts when confirmation is revoked during execution callback", async function () {
    const revokerAddr = await revoker.getAddress();
    const txId = await wallet
      .connect(owner1)
      .submitTransaction.staticCall(revokerAddr, ethers.parseEther("0.1"), "0x");
    await wallet
      .connect(owner1)
      .submitTransaction(revokerAddr, ethers.parseEther("0.1"), "0x");

    await revoker.arm(txId);
    await revoker.confirm();
    await wallet.connect(owner1).confirmTransaction(txId);
    await network.provider.send("evm_mine");

    // receive() tries revokeConfirmation under the execution lock → call fails → execute reverts
    await expect(wallet.connect(owner1).executeTransaction(txId)).to.be.revertedWith(
      "Execution failed"
    );
    expect((await wallet.transactions(txId)).executed).to.equal(false);
  });

  it("block-level snapshot resists same-block front-running revoke", async function () {
    const txId = await wallet
      .connect(owner1)
      .submitTransaction.staticCall(recipient.address, ethers.parseEther("1"), "0x");
    await wallet
      .connect(owner1)
      .submitTransaction(recipient.address, ethers.parseEther("1"), "0x");

    await wallet.connect(owner1).confirmTransaction(txId);
    await wallet.connect(owner2).confirmTransaction(txId);

    // Move to a new block so confirmations are in the past relative to execute
    await network.provider.send("evm_mine");

    const priorBlock = (await ethers.provider.getBlockNumber()) - 1;
    expect(await wallet.isConfirmedAtBlock(txId, owner1.address, priorBlock)).to.equal(true);
    expect(await wallet.isConfirmedAtBlock(txId, owner2.address, priorBlock)).to.equal(true);
    expect(await wallet.getConfirmationCountAtBlock(txId, priorBlock)).to.equal(2n);

    // Same-block front-run: queue revoke then execute, mine once
    await network.provider.send("evm_setAutomine", [false]);
    try {
      const before = await ethers.provider.getBalance(recipient.address);
      const revokeTx = await wallet.connect(owner2).revokeConfirmation(txId);
      const execTx = await wallet.connect(owner1).executeTransaction(txId);
      await network.provider.send("evm_mine");
      await revokeTx.wait();
      await execTx.wait();

      // Live count reflects the revoke, but prior-block snapshot still had 2 confirms
      expect(await wallet.getConfirmationCount(txId)).to.equal(1n);
      expect(await wallet.getConfirmationCountAtBlock(txId, priorBlock)).to.equal(2n);

      const after = await ethers.provider.getBalance(recipient.address);
      expect(after - before).to.equal(ethers.parseEther("1"));
      expect((await wallet.transactions(txId)).executed).to.equal(true);
    } finally {
      await network.provider.send("evm_setAutomine", [true]);
    }
  });

  it("executeTransaction gas for simple ETH transfer stays under 100000", async function () {
    // Use a 2-of-2 wallet without the revoker owner to keep the owner loop small
    const lean = await deployWallet([owner1.address, owner2.address], 2);
    await owner1.sendTransaction({
      to: await lean.getAddress(),
      value: ethers.parseEther("2"),
    });

    const txId = await lean
      .connect(owner1)
      .submitTransaction.staticCall(recipient.address, ethers.parseEther("1"), "0x");
    await lean
      .connect(owner1)
      .submitTransaction(recipient.address, ethers.parseEther("1"), "0x");
    await lean.connect(owner1).confirmTransaction(txId);
    await lean.connect(owner2).confirmTransaction(txId);
    await network.provider.send("evm_mine");

    const tx = await lean.connect(owner1).executeTransaction(txId);
    const receipt = await tx.wait();
    expect(receipt.gasUsed).to.be.lte(100000n);
  });

  it("isConfirmedAtBlock reflects confirmation and revocation history", async function () {
    const txId = await wallet
      .connect(owner1)
      .submitTransaction.staticCall(recipient.address, ethers.parseEther("1"), "0x");
    await wallet
      .connect(owner1)
      .submitTransaction(recipient.address, ethers.parseEther("1"), "0x");

    await wallet.connect(owner1).confirmTransaction(txId);
    const confirmBlock = await ethers.provider.getBlockNumber();

    await network.provider.send("evm_mine");
    await network.provider.send("evm_mine");

    expect(await wallet.isConfirmedAtBlock(txId, owner1.address, confirmBlock)).to.equal(true);
    expect(await wallet.isConfirmedAtBlock(txId, owner1.address, confirmBlock - 1)).to.equal(
      false
    );

    await wallet.connect(owner1).revokeConfirmation(txId);
    const revokeBlock = await ethers.provider.getBlockNumber();

    expect(await wallet.isConfirmedAtBlock(txId, owner1.address, confirmBlock)).to.equal(true);
    expect(await wallet.isConfirmedAtBlock(txId, owner1.address, revokeBlock)).to.equal(false);
    expect(await wallet.isConfirmedAtBlock(txId, owner1.address, revokeBlock - 1)).to.equal(
      true
    );
  });
});
