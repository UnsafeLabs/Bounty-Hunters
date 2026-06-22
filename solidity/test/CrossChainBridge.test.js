const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("CrossChainBridge", function () {
  async function deployFixture() {
    const [validator, user1, user2, attacker] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    const token = await MockToken.deploy("Bridge Token", "BRG", ethers.parseEther("1000000"));
    await token.waitForDeployment();

    const Bridge = await ethers.getContractFactory("CrossChainBridge");
    const bridge = await Bridge.deploy(await token.getAddress(), validator.address);
    await bridge.waitForDeployment();

    await token.transfer(user1.address, ethers.parseEther("1000"));
    await token.connect(user1).approve(await bridge.getAddress(), ethers.parseEther("1000"));

    return { bridge, token, validator, user1, user2, attacker };
  }

  describe("Deployment", function () {
    it("should set the correct validator and token", async function () {
      const { bridge, token, validator } = await loadFixture(deployFixture);
      expect(await bridge.bridgeToken()).to.equal(await token.getAddress());
      expect(await bridge.validator()).to.equal(validator.address);
    });

    it("should compute a domain separator", async function () {
      const { bridge } = await loadFixture(deployFixture);
      expect(await bridge.DOMAIN_SEPARATOR()).to.not.equal(ethers.ZeroHash);
    });
  });

  describe("initiateTransfer", function () {
    it("should initiate a transfer and emit event", async function () {
      const { bridge, user1 } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("100");
      await expect(bridge.connect(user1).initiateTransfer(amount, 1))
        .to.emit(bridge, "TransferInitiated")
        .withArgs(user1.address, amount, 1, 0);
    });

    it("should reject zero amount", async function () {
      const { bridge, user1 } = await loadFixture(deployFixture);
      await expect(bridge.connect(user1).initiateTransfer(0, 1))
        .to.be.revertedWith("Amount must be > 0");
    });

    it("should increment nonce per sender", async function () {
      const { bridge, user1 } = await loadFixture(deployFixture);
      await bridge.connect(user1).initiateTransfer(ethers.parseEther("50"), 1);
      await bridge.connect(user1).initiateTransfer(ethers.parseEther("50"), 2);
      expect(await bridge.senderNonce(user1.address)).to.equal(2n);
    });
  });

  describe("processTransfer with EIP-712", function () {
    async function signTransfer(bridge, signer, recipient, amount, nonce) {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const bridgeAddr = await bridge.getAddress();
      const domain = { name: "CrossChainBridge", version: "1", chainId: chainId, verifyingContract: bridgeAddr };
      const types = { Transfer: [
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ]};
      const value = { recipient, amount, nonce };
      return await signer.signTypedData(domain, types, value);
    }

    it("should process a valid transfer with correct EIP-712 signature", async function () {
      const { bridge, token, validator, user1 } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("100");
      await token.transfer(await bridge.getAddress(), ethers.parseEther("500"));
      const nonce = await bridge.senderNonce(user1.address);
      const sig = await signTransfer(bridge, validator, user1.address, amount, nonce);
      await expect(bridge.processTransfer(user1.address, amount, nonce, sig))
        .to.emit(bridge, "TransferProcessed");
      expect(await token.balanceOf(user1.address)).to.equal(ethers.parseEther("1100"));
    });

    it("should reject transfer with invalid nonce (same-chain replay protection)", async function () {
      const { bridge, token, validator, user1 } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("50");
      await token.transfer(await bridge.getAddress(), ethers.parseEther("500"));
      const nonce0 = await bridge.senderNonce(user1.address);
      const sig = await signTransfer(bridge, validator, user1.address, amount, nonce0);
      await bridge.processTransfer(user1.address, amount, nonce0, sig);
      await expect(bridge.processTransfer(user1.address, amount, nonce0, sig))
        .to.be.revertedWith("Invalid nonce");
    });

    it("should reject transfer with invalid signature (zero-address check)", async function () {
      const { bridge, user1 } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("50");
      const nonce = await bridge.senderNonce(user1.address);
      const badSig = "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001b";
      await expect(bridge.processTransfer(user1.address, amount, nonce, badSig))
        .to.be.revertedWith("Invalid signature: zero address");
    });

    it("should reject transfer signed by non-validator", async function () {
      const { bridge, token, user1, attacker } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("50");
      await token.transfer(await bridge.getAddress(), ethers.parseEther("500"));
      const nonce = await bridge.senderNonce(user1.address);
      const sig = await signTransfer(bridge, attacker, user1.address, amount, nonce);
      await expect(bridge.processTransfer(user1.address, amount, nonce, sig))
        .to.be.revertedWith("Invalid signature");
    });

    it("should reject transfer signed with wrong chain ID (cross-chain replay)", async function () {
      const { bridge, token, validator, user1 } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("50");
      await token.transfer(await bridge.getAddress(), ethers.parseEther("500"));
      const nonce = await bridge.senderNonce(user1.address);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const bridgeAddr = await bridge.getAddress();
      const wrongDomain = { name: "CrossChainBridge", version: "1", chainId: chainId + 1n, verifyingContract: bridgeAddr };
      const types = { Transfer: [{ name: "recipient", type: "address" }, { name: "amount", type: "uint256" }, { name: "nonce", type: "uint256" }] };
      const wrongSig = await validator.signTypedData(wrongDomain, types, { recipient: user1.address, amount, nonce });
      await expect(bridge.processTransfer(user1.address, amount, nonce, wrongSig))
        .to.be.revertedWith("Invalid signature");
    });

    it("should reject transfer signed for a different contract address", async function () {
      const { bridge, token, validator, user1 } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("50");
      await token.transfer(await bridge.getAddress(), ethers.parseEther("500"));
      const nonce = await bridge.senderNonce(user1.address);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const Bridge = await ethers.getContractFactory("CrossChainBridge");
      const fakeBridge = await Bridge.deploy(await token.getAddress(), validator.address);
      await fakeBridge.waitForDeployment();
      const wrongDomain = { name: "CrossChainBridge", version: "1", chainId, verifyingContract: await fakeBridge.getAddress() };
      const types = { Transfer: [{ name: "recipient", type: "address" }, { name: "amount", type: "uint256" }, { name: "nonce", type: "uint256" }] };
      const wrongSig = await validator.signTypedData(wrongDomain, types, { recipient: user1.address, amount, nonce });
      await expect(bridge.processTransfer(user1.address, amount, nonce, wrongSig))
        .to.be.revertedWith("Invalid signature");
    });

    it("should query nonce via getNonce for frontend integration", async function () {
      const { bridge, user1 } = await loadFixture(deployFixture);
      expect(await bridge.getNonce(user1.address)).to.equal(0n);
    });
  });
});
