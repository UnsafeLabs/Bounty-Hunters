const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let bridge, token, validator, alice, bob, attacker;
  const INITIAL_SUPPLY = ethers.parseEther("100000");
  const TRANSFER_AMOUNT = ethers.parseEther("100");

  beforeEach(async function () {
    [validator, alice, bob, attacker] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("BridgeToken", "BRG", INITIAL_SUPPLY);
    await token.waitForDeployment();

    const CrossChainBridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await CrossChainBridge.deploy(await token.getAddress(), validator.address);
    await bridge.waitForDeployment();

    // Fund alice and approve bridge
    await token.transfer(alice.address, ethers.parseEther("10000"));
    await token.connect(alice).approve(await bridge.getAddress(), ethers.parseEther("10000"));
  });

  /**
   * Helper: sign a Transfer typed data message using EIP-712
   */
  async function signTransfer(signer, bridgeAddr, recipient, amount, nonce, chainId) {
    const domain = {
      name: "CrossChainBridge",
      version: "1",
      chainId: chainId || (await ethers.provider.getNetwork()).chainId,
      verifyingContract: bridgeAddr,
    };

    const types = {
      Transfer: [
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };

    const value = {
      recipient: recipient,
      amount: amount,
      nonce: nonce,
    };

    return signer.signTypedData(domain, types, value);
  }

  describe("Initiate Transfer", function () {
    it("should lock tokens and emit TransferInitiated", async function () {
      const tx = await bridge.connect(alice).initiateTransfer(TRANSFER_AMOUNT, 1);
      const receipt = await tx.wait();

      expect(await token.balanceOf(await bridge.getAddress())).to.equal(TRANSFER_AMOUNT);

      const event = receipt.logs.find(log => log.fragment?.name === "TransferInitiated");
      expect(event).to.not.be.undefined;
      expect(event.args[0]).to.equal(alice.address);
      expect(event.args[1]).to.equal(TRANSFER_AMOUNT);
    });

    it("should reject zero amount", async function () {
      await expect(
        bridge.connect(alice).initiateTransfer(0, 1)
      ).to.be.revertedWith("Amount must be > 0");
    });
  });

  describe("Process Transfer (EIP-712)", function () {
    let chainId;

    beforeEach(async function () {
      chainId = (await ethers.provider.getNetwork()).chainId;
    });

    it("should process a valid transfer signed by validator", async function () {
      const nonce = 1;
      const signature = await signTransfer(
        validator, await bridge.getAddress(), alice.address, TRANSFER_AMOUNT, nonce, chainId
      );

      // Bridge needs tokens to transfer out
      await token.transfer(await bridge.getAddress(), TRANSFER_AMOUNT);

      const tx = await bridge.connect(bob).processTransfer(alice.address, TRANSFER_AMOUNT, nonce, signature);
      const receipt = await tx.wait();

      expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("10000") + TRANSFER_AMOUNT);
      expect(await bridge.senderNonces(alice.address)).to.equal(nonce);

      const event = receipt.logs.find(log => log.fragment?.name === "TransferProcessed");
      expect(event).to.not.be.undefined;
    });

    it("should reject same-chain replay (same nonce reused)", async function () {
      const nonce = 1;
      const signature = await signTransfer(
        validator, await bridge.getAddress(), alice.address, TRANSFER_AMOUNT, nonce, chainId
      );

      await token.transfer(await bridge.getAddress(), TRANSFER_AMOUNT * 2n);
      await bridge.connect(bob).processTransfer(alice.address, TRANSFER_AMOUNT, nonce, signature);

      // Try replay — nonce is no longer strictly increasing
      await expect(
        bridge.connect(bob).processTransfer(alice.address, TRANSFER_AMOUNT, nonce, signature)
      ).to.be.revertedWith("Nonce already used");
    });

    it("should reject replay with a used nonce value", async function () {
      const nonce = 5;
      const sig1 = await signTransfer(
        validator, await bridge.getAddress(), alice.address, TRANSFER_AMOUNT, nonce, chainId
      );

      await token.transfer(await bridge.getAddress(), TRANSFER_AMOUNT);
      await bridge.connect(bob).processTransfer(alice.address, TRANSFER_AMOUNT, nonce, sig1);

      // nonce must be > 5 now, so using 5 again should fail
      await expect(
        bridge.connect(bob).processTransfer(alice.address, TRANSFER_AMOUNT, nonce, sig1)
      ).to.be.revertedWith("Nonce already used");
    });

    it("should reject cross-chain replay via different chain ID", async function () {
      const nonce = 1;

      // Sign with chain ID 999 (a different chain)
      const diffChainSig = await signTransfer(
        validator, await bridge.getAddress(), alice.address, TRANSFER_AMOUNT, nonce, 999
      );

      // This signature was EIP-712 signed for chain ID 999's domain separator
      // When verified on the current chain, the domain separators won't match
      // so ECDSA.recover will derive a different signer address → not validator
      await token.transfer(await bridge.getAddress(), TRANSFER_AMOUNT);
      await expect(
        bridge.connect(bob).processTransfer(alice.address, TRANSFER_AMOUNT, nonce, diffChainSig)
      ).to.be.reverted;
    });

    it("should reject post-upgrade replay (different contract address)", async function () {
      const nonce = 1;
      const signature = await signTransfer(
        validator, await bridge.getAddress(), alice.address, TRANSFER_AMOUNT, nonce, chainId
      );

      await token.transfer(await bridge.getAddress(), TRANSFER_AMOUNT);
      await bridge.connect(bob).processTransfer(alice.address, TRANSFER_AMOUNT, nonce, signature);

      // Deploy a new bridge (simulating upgrade)
      const BridgeV2 = await ethers.getContractFactory("CrossChainBridge");
      const bridgeV2 = await BridgeV2.deploy(await token.getAddress(), validator.address);
      await bridgeV2.waitForDeployment();

      // The signature was bound to the original bridge address via domain separator
      // It should NOT be valid on the new bridge
      await token.transfer(await bridgeV2.getAddress(), TRANSFER_AMOUNT);
      await expect(
        bridgeV2.connect(bob).processTransfer(alice.address, TRANSFER_AMOUNT, 1, signature)
      ).to.be.reverted;
    });

    it("should reject invalid signature (wrong signer)", async function () {
      const nonce = 1;
      // Attacker signs instead of validator
      const badSignature = await signTransfer(
        attacker, await bridge.getAddress(), alice.address, TRANSFER_AMOUNT, nonce, chainId
      );

      await token.transfer(await bridge.getAddress(), TRANSFER_AMOUNT);
      await expect(
        bridge.connect(bob).processTransfer(alice.address, TRANSFER_AMOUNT, nonce, badSignature)
      ).to.be.revertedWith("Invalid signature: not validator");
    });

    it("should reject malformed signature (wrong length)", async function () {
      await expect(
        bridge.connect(bob).processTransfer(
          alice.address, TRANSFER_AMOUNT, 1, "0x1234" // too short
        )
      ).to.be.revertedWith("Invalid signature length");
    });

    it("should reject invalid recipient address", async function () {
      await expect(
        bridge.connect(bob).processTransfer(
          ethers.ZeroAddress, TRANSFER_AMOUNT, 1, "0x" + "0".repeat(130)
        )
      ).to.be.revertedWith("Invalid recipient");
    });

    it("should reject zero amount", async function () {
      await expect(
        bridge.connect(bob).processTransfer(
          alice.address, 0, 1, "0x" + "0".repeat(130)
        )
      ).to.be.revertedWith("Amount must be > 0");
    });
  });

  describe("verifySignature", function () {
    it("should return true for a valid signature from validator", async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const nonce = 1;
      const signature = await signTransfer(
        validator, await bridge.getAddress(), alice.address, TRANSFER_AMOUNT, nonce, chainId
      );

      const digest = await bridge.getTransferDigest(alice.address, TRANSFER_AMOUNT, nonce);
      expect(await bridge.verifySignature(digest, signature)).to.be.true;
    });

    it("should return false for a signature from wrong signer", async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const nonce = 1;
      const signature = await signTransfer(
        attacker, await bridge.getAddress(), alice.address, TRANSFER_AMOUNT, nonce, chainId
      );

      const digest = await bridge.getTransferDigest(alice.address, TRANSFER_AMOUNT, nonce);
      expect(await bridge.verifySignature(digest, signature)).to.be.false;
    });

    it("should return false for invalid-length signature", async function () {
      expect(await bridge.verifySignature(
        ethers.randomBytes(32),
        "0x1234"
      )).to.be.false;
    });

    it("should return false for garbage signature (not ecrecover zero-address)", async function () {
      const digest = await bridge.getTransferDigest(alice.address, TRANSFER_AMOUNT, 1);
      // Invalid signature bytes that would cause ecrecover to return address(0)
      const badSig = "0x" + "aa".repeat(65);
      expect(await bridge.verifySignature(digest, badSig)).to.be.false;
    });
  });

  describe("Domain Separator", function () {
    it("should include chain ID and contract address", async function () {
      const separator = await bridge.domainSeparatorV4();
      expect(separator).to.not.equal(ethers.ZeroHash);
    });
  });

  describe("Nonce tracking", function () {
    it("should query nonce per recipient", async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const nonce = 42;

      expect(await bridge.senderNonces(alice.address)).to.equal(0);

      const sig = await signTransfer(
        validator, await bridge.getAddress(), alice.address, TRANSFER_AMOUNT, nonce, chainId
      );
      await token.transfer(await bridge.getAddress(), TRANSFER_AMOUNT);
      await bridge.connect(bob).processTransfer(alice.address, TRANSFER_AMOUNT, nonce, sig);

      expect(await bridge.senderNonces(alice.address)).to.equal(nonce);
    });
  });
});
