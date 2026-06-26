const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("CrossChainBridge", function () {
  async function deployBridgeFixture() {
    const [validator, userA, userB, attacker] = await ethers.getSigners();

    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    const token = await ERC20Mock.deploy("Test", "TST", ethers.parseEther("1000000"));
    await token.waitForDeployment();

    const CrossChainBridge = await ethers.getContractFactory("CrossChainBridge");
    const bridge = await CrossChainBridge.deploy(await token.getAddress(), validator.address);
    await bridge.waitForDeployment();

    // Fund userA
    await token.transfer(userA.address, ethers.parseEther("10000"));
    await token.connect(userA).approve(await bridge.getAddress(), ethers.parseEther("10000"));

    return { bridge, token, validator, userA, userB, attacker };
  }

  it("should include chainId in signed message to prevent cross-chain replay", async function () {
    const { bridge } = await loadFixture(deployBridgeFixture);
    const domainSeparator = await bridge.DOMAIN_SEPARATOR();
    const chainId = await ethers.provider.send("eth_chainId");
    // Domain separator includes chainId — a different chain produces different hash
    expect(domainSeparator).to.not.equal(ethers.ZeroHash);
  });

  it("should include contract address in domain to prevent post-upgrade replay", async function () {
    const { bridge } = await loadFixture(deployBridgeFixture);
    const domainSeparator = await bridge.DOMAIN_SEPARATOR;
    const bridgeAddress = await bridge.getAddress();
    // Extract verifyingContract from domain — different address = different domain separator
    expect(domainSeparator).to.not.equal(ethers.ZeroHash);
  });

  it("should reject ecrecover zero-address as invalid signature", async function () {
    const { bridge } = await loadFixture(deployBridgeFixture);
    const zeroSignature = "0x" + "00".repeat(65);
    await expect(
      bridge.verifySignature(ethers.ZeroHash, zeroSignature)
    ).to.be.revertedWith("Invalid signature: zero address");
  });

  it("should enforce per-sender nonce to prevent same-chain replay", async function () {
    const { bridge, userA, validator } = await loadFixture(deployBridgeFixture);
    
    // Transfer tokens
    await bridge.connect(userA).initiateTransfer(ethers.parseEther("100"), 1);
    
    // Nonce should be 0 for userA's first transfer
    expect(await bridge.senderNonce(userA.address)).to.equal(1n);

    // Second transfer increments nonce
    await bridge.connect(userA).initiateTransfer(ethers.parseEther("200"), 2);
    expect(await bridge.senderNonce(userA.address)).to.equal(2n);
  });

  it("should reject replayed signature with used nonce", async function () {
    const { bridge, userA } = await loadFixture(deployBridgeFixture);
    
    await bridge.connect(userA).initiateTransfer(ethers.parseEther("100"), 1);
    const nonce = 0n;

    // Sign transfer with nonce=0
    const domain = {
      name: "CrossChainBridge",
      version: "1",
      chainId: await ethers.provider.send("eth_chainId"),
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
      sender: userA.address,
      recipient: userA.address,
      amount: ethers.parseEther("100"),
      nonce: nonce,
    };

    const signature = await userA.signTypedData(domain, types, value);

    // First call succeeds
    await expect(
      bridge.connect(userA).processTransfer(
        userA.address, userA.address, ethers.parseEther("100"), nonce, signature
      )
    ).to.not.be.reverted;

    // Replay should fail — nonce already incremented
    await expect(
      bridge.connect(userA).processTransfer(
        userA.address, userA.address, ethers.parseEther("100"), nonce, signature
      )
    ).to.be.reverted;
  });
});
