const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge EIP-712 replay protection (#920)", function () {
  let bridge, token, validator, sender, recipient, other;
  let validatorWallet;

  const NAME = "CrossChainBridge";
  const VERSION = "1";

  async function deployBridge(tokenAddr, validatorAddr) {
    const Factory = await ethers.getContractFactory("CrossChainBridge");
    const b = await Factory.deploy(tokenAddr, validatorAddr);
    await b.waitForDeployment();
    return b;
  }

  async function domain(bridgeAddr, chainId) {
    return {
      name: NAME,
      version: VERSION,
      chainId,
      verifyingContract: bridgeAddr,
    };
  }

  const types = {
    BridgeTransfer: [
      { name: "sender", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  };

  async function signTransfer(bridgeAddr, chainId, senderAddr, recipientAddr, amount, nonce) {
    const value = {
      sender: senderAddr,
      recipient: recipientAddr,
      amount,
      nonce,
    };
    const sig = await validatorWallet.signTypedData(
      await domain(bridgeAddr, chainId),
      types,
      value
    );
    return sig;
  }

  beforeEach(async function () {
    [validatorWallet, sender, recipient, other] = await ethers.getSigners();
    validator = validatorWallet;

    const Mock = await ethers.getContractFactory("MockERC20");
    token = await Mock.deploy();
    await token.waitForDeployment();

    bridge = await deployBridge(await token.getAddress(), validator.address);

    // Fund the bridge so processTransfer can pay out
    await token.mint(await bridge.getAddress(), ethers.parseEther("1000000"));
    await token.mint(sender.address, ethers.parseEther("100000"));
    await token.connect(sender).approve(await bridge.getAddress(), ethers.MaxUint256);
  });

  it("processes a valid EIP-712 transfer and increments sender nonce", async function () {
    const amount = ethers.parseEther("10");
    const nonce = await bridge.getNonce(sender.address);
    expect(nonce).to.equal(0n);

    const network = await ethers.provider.getNetwork();
    const sig = await signTransfer(
      await bridge.getAddress(),
      network.chainId,
      sender.address,
      recipient.address,
      amount,
      nonce
    );

    const before = await token.balanceOf(recipient.address);
    await expect(
      bridge.processTransfer(sender.address, recipient.address, amount, nonce, sig)
    ).to.emit(bridge, "TransferProcessed");

    expect(await token.balanceOf(recipient.address)).to.equal(before + amount);
    expect(await bridge.getNonce(sender.address)).to.equal(1n);
  });

  it("rejects same-chain replay (nonce consumed)", async function () {
    const amount = ethers.parseEther("5");
    const network = await ethers.provider.getNetwork();
    const nonce = 0n;
    const sig = await signTransfer(
      await bridge.getAddress(),
      network.chainId,
      sender.address,
      recipient.address,
      amount,
      nonce
    );

    await bridge.processTransfer(sender.address, recipient.address, amount, nonce, sig);

    await expect(
      bridge.processTransfer(sender.address, recipient.address, amount, nonce, sig)
    ).to.be.revertedWith("Invalid nonce");
  });

  it("rejects cross-chain replay (wrong chainId in domain)", async function () {
    const amount = ethers.parseEther("5");
    const network = await ethers.provider.getNetwork();
    const nonce = await bridge.getNonce(sender.address);

    // Signature bound to a different chainId
    const foreignChainId = network.chainId + 1n;
    const sig = await signTransfer(
      await bridge.getAddress(),
      foreignChainId,
      sender.address,
      recipient.address,
      amount,
      nonce
    );

    await expect(
      bridge.processTransfer(sender.address, recipient.address, amount, nonce, sig)
    ).to.be.revertedWith("Invalid signature");
  });

  it("rejects post-upgrade / replacement-contract replay", async function () {
    const amount = ethers.parseEther("5");
    const network = await ethers.provider.getNetwork();
    const nonce = await bridge.getNonce(sender.address);

    // Deploy a second bridge (different verifyingContract)
    const bridge2 = await deployBridge(await token.getAddress(), validator.address);
    await token.mint(await bridge2.getAddress(), ethers.parseEther("1000"));

    // Sign for bridge1, try to redeem on bridge2
    const sig = await signTransfer(
      await bridge.getAddress(),
      network.chainId,
      sender.address,
      recipient.address,
      amount,
      nonce
    );

    await expect(
      bridge2.processTransfer(sender.address, recipient.address, amount, nonce, sig)
    ).to.be.revertedWith("Invalid signature");
  });

  it("rejects invalid / non-validator signatures", async function () {
    const amount = ethers.parseEther("5");
    const network = await ethers.provider.getNetwork();
    const nonce = await bridge.getNonce(sender.address);

    // Signed by `other`, not the validator
    const value = {
      sender: sender.address,
      recipient: recipient.address,
      amount,
      nonce,
    };
    const sig = await other.signTypedData(
      await domain(await bridge.getAddress(), network.chainId),
      types,
      value
    );

    await expect(
      bridge.processTransfer(sender.address, recipient.address, amount, nonce, sig)
    ).to.be.revertedWith("Invalid signature");
  });

  it("DOMAIN_SEPARATOR encodes name, version, chainId, verifyingContract", async function () {
    const network = await ethers.provider.getNetwork();
    const expected = ethers.TypedDataEncoder.hashDomain({
      name: NAME,
      version: VERSION,
      chainId: network.chainId,
      verifyingContract: await bridge.getAddress(),
    });
    // hashDomain returns the domain separator itself
    expect(await bridge.DOMAIN_SEPARATOR()).to.equal(expected);
  });

  it("verifySignature rejects zero-address ecrecover (malformed v)", async function () {
    // 65-byte signature with v=0 and r=s=0 → ecrecover returns address(0)
    const bad = "0x" + "00".repeat(64) + "00";
    const digest = ethers.id("anything");
    await expect(bridge.verifySignature(digest, bad)).to.be.revertedWith("Invalid signer");
  });

  it("initiateTransfer emits outbound nonce and pulls tokens", async function () {
    const amount = ethers.parseEther("3");
    await expect(bridge.connect(sender).initiateTransfer(amount, 137))
      .to.emit(bridge, "TransferInitiated")
      .withArgs(sender.address, amount, 137, 0);

    expect(await bridge.outboundNonce()).to.equal(1n);
  });

  it("hashTransfer digests differ across chainId and verifyingContract", async function () {
    const amount = ethers.parseEther("1");
    const network = await ethers.provider.getNetwork();
    const h1 = await bridge.hashTransfer(sender.address, recipient.address, amount, 0);
    // Redeploy = different verifyingContract → different digest
    const bridge2 = await deployBridge(await token.getAddress(), validator.address);
    const h2 = await bridge2.hashTransfer(sender.address, recipient.address, amount, 0);
    expect(h1).to.not.equal(h2);
    // Local digest must match ethers TypedDataEncoder with this domain
    const expected = ethers.TypedDataEncoder.hash(
      await domain(await bridge.getAddress(), network.chainId),
      types,
      { sender: sender.address, recipient: recipient.address, amount, nonce: 0n }
    );
    expect(h1).to.equal(expected);
  });
});
