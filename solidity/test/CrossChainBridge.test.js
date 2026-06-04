const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let bridge;
  let token;
  let owner;
  let validator;
  let recipient;

  beforeEach(async function () {
    [owner, validator, recipient] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("contracts/GovernanceToken.sol:GovernanceToken");
    token = await Token.deploy(ethers.utils.parseEther("1000000"));
    await token.deployed();

    const Bridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await Bridge.deploy(token.address, validator.address);
    await bridge.deployed();

    // Give bridge some tokens
    await token.transfer(bridge.address, ethers.utils.parseEther("1000"));
  });

  async function getSignature(recipientAddress, amount, nonce, chainId, bridgeAddress) {
    const domain = {
      name: "CrossChainBridge",
      version: "1",
      chainId: chainId,
      verifyingContract: bridgeAddress
    };

    const types = {
      Transfer: [
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "transferNonce", type: "uint256" }
      ]
    };

    const value = {
      recipient: recipientAddress,
      amount: amount,
      transferNonce: nonce
    };

    return await validator._signTypedData(domain, types, value);
  }

  it("should process a valid cross-chain transfer", async function () {
    const amount = ethers.utils.parseEther("100");
    const nonce = 0;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const bridgeAddress = bridge.address;

    const signature = await getSignature(recipient.address, amount, nonce, chainId, bridgeAddress);

    await expect(bridge.processTransfer(recipient.address, amount, nonce, signature))
      .to.emit(bridge, "TransferProcessed");

    expect(await token.balanceOf(recipient.address)).to.equal(amount);
  });

  it("should reject same-chain replay (invalid nonce)", async function () {
    const amount = ethers.utils.parseEther("100");
    const nonce = 0;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const bridgeAddress = bridge.address;

    const signature = await getSignature(recipient.address, amount, nonce, chainId, bridgeAddress);

    await bridge.processTransfer(recipient.address, amount, nonce, signature);

    // Try to replay with the same nonce
    await expect(bridge.processTransfer(recipient.address, amount, nonce, signature))
      .to.be.revertedWith("Invalid nonce");
  });

  it("should reject cross-chain replay (invalid chain ID)", async function () {
    const amount = ethers.utils.parseEther("100");
    const nonce = 0;
    const wrongChainId = 999;
    const bridgeAddress = bridge.address;

    const signature = await getSignature(recipient.address, amount, nonce, wrongChainId, bridgeAddress);

    await expect(bridge.processTransfer(recipient.address, amount, nonce, signature))
      .to.be.revertedWith("Invalid signature"); 
  });

  it("should reject post-upgrade replay (invalid contract address)", async function () {
    const amount = ethers.utils.parseEther("100");
    const nonce = 0;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const wrongBridgeAddress = ethers.Wallet.createRandom().address;

    const signature = await getSignature(recipient.address, amount, nonce, chainId, wrongBridgeAddress);

    await expect(bridge.processTransfer(recipient.address, amount, nonce, signature))
      .to.be.revertedWith("Invalid signature");
  });

  it("should reject invalid signature from non-validator", async function () {
    const amount = ethers.utils.parseEther("100");
    const nonce = 0;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const bridgeAddress = bridge.address;

    const domain = {
      name: "CrossChainBridge",
      version: "1",
      chainId: chainId,
      verifyingContract: bridgeAddress
    };

    const types = {
      Transfer: [
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "transferNonce", type: "uint256" }
      ]
    };

    const value = {
      recipient: recipient.address,
      amount: amount,
      transferNonce: nonce
    };

    const signature = await owner._signTypedData(domain, types, value);

    await expect(bridge.processTransfer(recipient.address, amount, nonce, signature))
      .to.be.revertedWith("Invalid signature");
  });
});
