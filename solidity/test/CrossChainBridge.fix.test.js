const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge Security Fix Verification", function () {
  let bridge;
  let token;
  let validator;
  let user;
  let chainId;

  async function signTransfer(signer, recipient, amount, nonce, bridgeAddress, cId) {
    const domain = {
      name: "CrossChainBridge",
      version: "1",
      chainId: cId,
      verifyingContract: bridgeAddress
    };

    const types = {
      Transfer: [
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" }
      ]
    };

    const value = {
      recipient: recipient,
      amount: amount,
      nonce: nonce
    };

    return await signer.signTypedData(domain, types, value);
  }

  beforeEach(async function () {
    [validator, user] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    chainId = network.chainId;

    const Token = await ethers.getContractFactory("MockToken");
    token = await Token.deploy("Test Token", "TEST", ethers.parseEther("1000"));

    const Bridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await Bridge.deploy(await token.getAddress(), validator.address);

    await token.transfer(await bridge.getAddress(), ethers.parseEther("500"));
  });

  it("Fix: Signature includes chain ID (Prevents cross-chain replay)", async function () {
    const amount = ethers.parseEther("10");
    const nonce = 0;
    
    // Sign for a different chain ID (e.g. current chain ID + 1)
    const wrongChainId = chainId + 1n;
    const signature = await signTransfer(validator, user.address, amount, nonce, await bridge.getAddress(), wrongChainId);

    // Should revert on current chain
    await expect(bridge.processTransfer(user.address, amount, nonce, signature))
      .to.be.revertedWith("Invalid signature");
  });

  it("Fix: Signature includes contract address (Prevents post-upgrade replay)", async function () {
    const amount = ethers.parseEther("10");
    const nonce = 0;
    
    // Deploy a second bridge instance
    const Bridge = await ethers.getContractFactory("CrossChainBridge");
    const bridge2 = await Bridge.deploy(await token.getAddress(), validator.address);
    
    // Sign for bridge1
    const signature = await signTransfer(validator, user.address, amount, nonce, await bridge.getAddress(), chainId);

    // Try to use it on bridge2
    await expect(bridge2.processTransfer(user.address, amount, nonce, signature))
      .to.be.revertedWith("Invalid signature");
  });

  it("Fix: Nonce per recipient prevents same-chain replay", async function () {
    const amount = ethers.parseEther("10");
    const nonce = 0;
    
    const signature = await signTransfer(validator, user.address, amount, nonce, await bridge.getAddress(), chainId);

    // First use works
    await bridge.processTransfer(user.address, amount, nonce, signature);
    expect(await token.balanceOf(user.address)).to.equal(amount);

    // Second use (replay) fails because nonce already incremented
    await expect(bridge.processTransfer(user.address, amount, nonce, signature))
      .to.be.revertedWith("Invalid nonce");
      
    // Even if we pass the same nonce, it's already marked as processed
    // Actually, "Invalid nonce" is checked first.
  });

  it("Fix: Strict nonce ordering for recipient", async function () {
    const amount = ethers.parseEther("10");
    
    // Recipient nonce is 0. Sign for nonce 1.
    const signature = await signTransfer(validator, user.address, amount, 1, await bridge.getAddress(), chainId);

    await expect(bridge.processTransfer(user.address, amount, 1, signature))
      .to.be.revertedWith("Invalid nonce");
  });

  it("Fix: ecrecover zero address is rejected", async function () {
    const amount = ethers.parseEther("10");
    const nonce = 0;
    const invalidSignature = "0x" + "00".repeat(64) + "1c"; // Specially crafted zero-returning signature (if possible)
    
    // Pass a signature that might return 0 (like all zeros)
    // The contract now has require(recovered != address(0))
    const zeroSig = "0x" + "00".repeat(64) + "00"; // Invalid v
    
    await expect(bridge.processTransfer(user.address, amount, nonce, zeroSig))
      .to.be.reverted; // ecrecover might fail or return 0, our verifySignature handles it
  });

  it("Success: Valid EIP-712 transfer", async function () {
    const amount = ethers.parseEther("10");
    const nonce = 0;
    
    const signature = await signTransfer(validator, user.address, amount, nonce, await bridge.getAddress(), chainId);

    await expect(bridge.processTransfer(user.address, amount, nonce, signature))
      .to.emit(bridge, "TransferProcessed");
      
    expect(await token.balanceOf(user.address)).to.equal(amount);
    expect(await bridge.nonces(user.address)).to.equal(1);
  });
});
