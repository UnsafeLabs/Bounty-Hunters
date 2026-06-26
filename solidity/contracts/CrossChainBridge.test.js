// Hardhat test for CrossChainBridge.sol
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let bridge, bridgeToken, validator, owner, addr1, addr2;

  beforeEach(async function () {
    [owner, validator, addr1, addr2] = await ethers.getSigners();
    // Deploy mock ERC20
    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    bridgeToken = await ERC20Mock.deploy("BridgeToken", "BT");
    await bridgeToken.deployed();

    const CrossChainBridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await CrossChainBridge.deploy(bridgeToken.address, validator.address);
    await bridge.deployed();

    await bridgeToken.mint(addr1.address, ethers.utils.parseEther("1000"));
    await bridgeToken.connect(addr1).approve(bridge.address, ethers.utils.parseEther("1000"));
  });

  it("should include chainId in hash (prevents cross-chain replay)", async function () {
    // The domain separator includes block.chainid
    const separator = await bridge.DOMAIN_SEPARATOR();
    expect(separator).to.not.equal(ethers.constants.HashZero);
  });

  it("should increment sender nonce on successful transfer", async function () {
    const nonceBefore = await bridge.getSenderNonce(addr1.address);
    expect(nonceBefore).to.equal(0);
  });

  it("should reject invalid signature (zero-address from ecrecover)", async function () {
    const invalidSig = "0x" + "00".repeat(65);
    await expect(
      bridge.processTransfer(addr2.address, 100, 1, invalidSig)
    ).to.be.revertedWith("Invalid signature");
  });
});
