const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let token, bridge, validator, user, attacker;
  let domain;

  const TYPES = {
    Transfer: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  };

  beforeEach(async function () {
    [validator, user, attacker] = await ethers.getSigners();

    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    token = await ERC20Mock.deploy("BridgeToken", "BRG");

    const CrossChainBridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await CrossChainBridge.deploy(await token.getAddress(), validator.address);

    await token.mint(user.address, ethers.parseEther("1000000"));
    await token.mint(attacker.address, ethers.parseEther("1000000"));
    await token.connect(user).approve(await bridge.getAddress(), ethers.MaxUint256);
    await token.connect(attacker).approve(await bridge.getAddress(), ethers.MaxUint256);

    domain = {
      name: "CrossChainBridge",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await bridge.getAddress(),
    };
  });

  async function signTransfer(recipient, amount, nonce, signer) {
    return signer.signTypedData(domain, TYPES, { recipient, amount, nonce });
  }

  describe("processTransfer", function () {
    beforeEach(async function () {
      await token.mint(await bridge.getAddress(), ethers.parseEther("1000"));
    });

    it("should process a valid transfer", async function () {
      const amount = ethers.parseEther("100");
      const sig = await signTransfer(user.address, amount, 0, validator);

      await expect(bridge.connect(user).processTransfer(user.address, amount, 0, sig))
        .to.emit(bridge, "TransferProcessed");

      expect(await token.balanceOf(user.address)).to.equal(ethers.parseEther("1000100"));
    });

    it("should reject same nonce replay on same chain", async function () {
      const amount = ethers.parseEther("100");
      const sig = await signTransfer(user.address, amount, 0, validator);

      await bridge.connect(user).processTransfer(user.address, amount, 0, sig);

      await expect(
        bridge.connect(user).processTransfer(user.address, amount, 0, sig)
      ).to.be.revertedWith("Invalid nonce");
    });

    it("should reject cross-chain replay (different chain ID)", async function () {
      const amount = ethers.parseEther("100");
      const sig = await signTransfer(user.address, amount, 0, validator);

      // Simulate different chain by creating a bridge with altered domain
      const CrossChainBridge = await ethers.getContractFactory("CrossChainBridge");
      const bridge2 = await CrossChainBridge.deploy(await token.getAddress(), validator.address);

      await token.mint(await bridge2.getAddress(), ethers.parseEther("1000"));

      await expect(
        bridge2.connect(user).processTransfer(user.address, amount, 0, sig)
      ).to.be.revertedWith("Invalid signature");
    });

    it("should reject post-upgrade replay (different contract address)", async function () {
      const amount = ethers.parseEther("100");
      const sig = await signTransfer(user.address, amount, 0, validator);

      await bridge.connect(user).processTransfer(user.address, amount, 0, sig);

      // Deploy new bridge (simulate upgrade) — different verifyingContract in domain
      const CrossChainBridge = await ethers.getContractFactory("CrossChainBridge");
      const bridgeUpgraded = await CrossChainBridge.deploy(await token.getAddress(), validator.address);

      await token.mint(await bridgeUpgraded.getAddress(), ethers.parseEther("1000"));

      // Signature includes old contract address in domain — should fail
      await expect(
        bridgeUpgraded.connect(user).processTransfer(user.address, amount, 0, sig)
      ).to.be.revertedWith("Invalid signature");
    });

    it("should reject invalid signature (wrong signer)", async function () {
      const amount = ethers.parseEther("100");
      const sig = await signTransfer(user.address, amount, 0, attacker);

      await expect(
        bridge.connect(user).processTransfer(user.address, amount, 0, sig)
      ).to.be.revertedWith("Invalid signature");
    });

    it("should use correct nonce per sender", async function () {
      const amount = ethers.parseEther("100");

      const sig1 = await signTransfer(user.address, amount, 0, validator);
      await bridge.connect(user).processTransfer(user.address, amount, 0, sig1);

      const sig2 = await signTransfer(user.address, amount, 1, validator);
      await bridge.connect(user).processTransfer(user.address, amount, 1, sig2);

      expect(await bridge.nonces(user.address)).to.equal(2);
    });

    it("should reject reused signature after successful transfer", async function () {
      const amount = ethers.parseEther("100");
      const sig = await signTransfer(user.address, amount, 0, validator);

      await bridge.connect(user).processTransfer(user.address, amount, 0, sig);

      await expect(
        bridge.connect(user).processTransfer(user.address, amount, 1, sig)
      ).to.be.revertedWith("Invalid signature");
    });

    it("should have a valid domain separator", async function () {
      const separator = await bridge.domainSeparator();
      const expectedDomain = {
        name: "CrossChainBridge",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await bridge.getAddress(),
      };
      expect(separator).to.not.equal(ethers.ZeroHash);
    });
  });

  describe("initiateTransfer", function () {
    it("should increment nonce per sender", async function () {
      await bridge.connect(user).initiateTransfer(ethers.parseEther("10"), 1);
      await bridge.connect(user).initiateTransfer(ethers.parseEther("20"), 2);
      expect(await bridge.nonces(user.address)).to.equal(2);
    });

    it("should revert on zero amount", async function () {
      await expect(
        bridge.connect(user).initiateTransfer(0, 1)
      ).to.be.revertedWith("Amount must be > 0");
    });
  });
});
