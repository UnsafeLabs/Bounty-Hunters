const { expect } = require("chai");
const { ethers } = require("hardhat");
const { SigningKey, verifyTypedData } = require("ethers");

describe("CrossChainBridge", function () {
  let bridge, validator, user, user2;
  const chainId = 31337; // Hardhat default

  beforeEach(async function () {
    [validator, user, user2] = await ethers.getSigners();
    const Bridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await Bridge.deploy(validator.address);
    await bridge.waitForDeployment();
  });

  async function signTransfer(signer, recipient, amount, nonce) {
    // EIP-712 typed data for the Transfer struct
    const domain = {
      name: "CrossChainBridge",
      version: "1",
      chainId: chainId,
      verifyingContract: await bridge.getAddress(),
    };
    const types = {
      Transfer: [
        { name: "sender", type: "address" },
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };
    const value = {
      sender: signer.address,
      recipient: recipient,
      amount: amount,
      nonce: nonce,
    };
    return await signer.signTypedData(domain, types, value);
  }

  it("should process a valid transfer", async function () {
    const nonce = await bridge.getNonce(user.address);
    const signature = await signTransfer(validator, user2.address, 100, nonce);
    await expect(bridge.connect(user).processTransfer(user2.address, 100, nonce, signature))
      .to.emit(bridge, "TransferProcessed")
      .withArgs(user.address, user2.address, 100, nonce);
    expect(await bridge.getNonce(user.address)).to.equal(nonce + 1n);
  });

  it("should reject cross-chain replay (different chainId)", async function () {
    // Simulate signature from another chain by manually crafting digest with wrong chainId
    const nonce = await bridge.getNonce(user.address);
    // Sign with a fake domain using a different chainId
    const fakeDomain = { name: "CrossChainBridge", version: "1", chainId: 1, verifyingContract: await bridge.getAddress() };
    const types = {
      Transfer: [
        { name: "sender", type: "address" },
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };
    const value = { sender: user.address, recipient: user2.address, amount: 100, nonce: nonce };
    const fakeSignature = await validator.signTypedData(fakeDomain, types, value);
    await expect(bridge.connect(user).processTransfer(user2.address, 100, nonce, fakeSignature))
      .to.be.revertedWith("Invalid signature");
  });

  it("should reject same-chain replay (nonce already used)", async function () {
    const nonce = await bridge.getNonce(user.address);
    const signature = await signTransfer(validator, user2.address, 100, nonce);
    await bridge.connect(user).processTransfer(user2.address, 100, nonce, signature);
    // Replay the same signature
    await expect(bridge.connect(user).processTransfer(user2.address, 100, nonce, signature))
      .to.be.revertedWith("Invalid nonce");
  });

  it("should reject replay after contract upgrade (different verifyingContract)", async function () {
    // Deploy a new bridge (simulates upgrade)
    const Bridge2 = await ethers.getContractFactory("CrossChainBridge");
    const bridge2 = await Bridge2.deploy(validator.address);
    await bridge2.waitForDeployment();

    const nonce = await bridge.getNonce(user.address);
    // Sign for the original contract address
    const signature = await signTransfer(validator, user2.address, 100, nonce);
    // Try to use it on the new contract address -> digest differs because verifyingContract changed
    await expect(bridge2.connect(user).processTransfer(user2.address, 100, nonce, signature))
      .to.be.revertedWith("Invalid signature");
  });

  it("should reject invalid signature (ecrecover zero-address)", async function () {
    // Use a random signer (not validator)
    const randomSigner = (await ethers.getSigners())[3];
    const nonce = await bridge.getNonce(user.address);
    const signature = await signTransfer(randomSigner, user2.address, 100, nonce);
    await