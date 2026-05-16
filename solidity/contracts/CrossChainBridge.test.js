const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let bridge;
  let owner;
  let validator1;
  let validator2;
  let validator3;
  let sender;
  let recipient;

  beforeEach(async function () {
    [owner, validator1, validator2, validator3, sender, recipient] = await ethers.getSigners();

    const CrossChainBridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await CrossChainBridge.deploy(2); // Require 2 confirmations
    await bridge.deployed();

    // Add validators
    await bridge.addValidator(validator1.address);
    await bridge.addValidator(validator2.address);
    await bridge.addValidator(validator3.address);
  });

  describe("Replay Protection", function () {
    it("should prevent cross-chain replay attacks", async function () {
      const amount = ethers.utils.parseEther("1.0");
      const sourceChainId = 1;
      const destChainId = 2;
      const nonce = 0;

      // Create transfer hash
      const transferHash = ethers.utils.solidityKeccak256(
        ["bytes32", "address", "address", "uint256", "uint256", "uint256", "uint256"],
        [
          ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes("Transfer(address sender,address recipient,uint256 amount,uint256 nonce,uint256 sourceChainId,uint256 destChainId)")
          ),
          sender.address,
          recipient.address,
          amount,
          nonce,
          sourceChainId,
          destChainId,
        ]
      );

      // Create EIP-712 hash
      const domainSeparator = await bridge.domainSeparator();
      const eip712Hash = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "bytes32", "bytes32"],
          ["\x19\x01", domainSeparator, transferHash]
        )
      );

      // Sign with validators
      const signature1 = await validator1.signMessage(ethers.utils.arrayify(eip712Hash));
      const signature2 = await validator2.signMessage(ethers.utils.arrayify(eip712Hash));

      // Process transfer on chain 2
      await bridge.processTransfer(
        sender.address,
        recipient.address,
        amount,
        sourceChainId,
        [signature1, signature2]
      );

      // Try to replay on chain 2 (should fail)
      await expect(
        bridge.processTransfer(
          sender.address,
          recipient.address,
          amount,
          sourceChainId,
          [signature1, signature2]
        )
      ).to.be.revertedWith("Transfer already processed");
    });

    it("should prevent same-chain replay attacks via nonce", async function () {
      const amount = ethers.utils.parseEther("1.0");
      const chainId = await ethers.provider.getNetwork().then((n) => n.chainId);

      // Process first transfer
      const nonce0 = 0;
      const transferHash0 = ethers.utils.solidityKeccak256(
        ["bytes32", "address", "address", "uint256", "uint256", "uint256", "uint256"],
        [
          ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes("Transfer(address sender,address recipient,uint256 amount,uint256 nonce,uint256 sourceChainId,uint256 destChainId)")
          ),
          sender.address,
          recipient.address,
          amount,
          nonce0,
          chainId,
          chainId,
        ]
      );

      const domainSeparator = await bridge.domainSeparator();
      const eip712Hash0 = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "bytes32", "bytes32"],
          ["\x19\x01", domainSeparator, transferHash0]
        )
      );

      const signature1_0 = await validator1.signMessage(ethers.utils.arrayify(eip712Hash0));
      const signature2_0 = await validator2.signMessage(ethers.utils.arrayify(eip712Hash0));

      await bridge.processTransfer(
        sender.address,
        recipient.address,
        amount,
        chainId,
        [signature1_0, signature2_0]
      );

      // Process second transfer with incremented nonce
      const nonce1 = 1;
      const transferHash1 = ethers.utils.solidityKeccak256(
        ["bytes32", "address", "address", "uint256", "uint256", "uint256", "uint256"],
        [
          ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes("Transfer(address sender,address recipient,uint256 amount,uint256 nonce,uint256 sourceChainId,uint256 destChainId)")
          ),
          sender.address,
          recipient.address,
          amount,
          nonce1,
          chainId,
          chainId,
        ]
      );

      const eip712Hash1 = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "bytes32", "bytes32"],
          ["\x19\x01", domainSeparator, transferHash1]
        )
      );

      const signature1_1 = await validator1.signMessage(ethers.utils.arrayify(eip712Hash1));
      const signature2_1 = await validator2.signMessage(ethers.utils.arrayify(eip712Hash1));

      // Should succeed with new nonce
      await bridge.processTransfer(
        sender.address,
        recipient.address,
        amount,
        chainId,
        [signature1_1, signature2_1]
      );

      // Verify nonce incremented
      expect(await bridge.getNonce(sender.address)).to.equal(2);
    });

    it("should reject invalid signatures (zero address)", async function () {
      const amount = ethers.utils.parseEther("1.0");
      const chainId = await ethers.provider.getNetwork().then((n) => n.chainId);

      // Create a transfer hash
      const transferHash = ethers.utils.solidityKeccak256(
        ["bytes32", "address", "address", "uint256", "uint256", "uint256", "uint256"],
        [
          ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes("Transfer(address sender,address recipient,uint256 amount,uint256 nonce,uint256 sourceChainId,uint256 destChainId)")
          ),
          sender.address,
          recipient.address,
          amount,
          0,
          chainId,
          chainId,
        ]
      );

      // Create invalid signature (all zeros)
      const invalidSignature = ethers.utils.hexlify(ethers.utils.zeros(65));

      // Should fail with invalid signature
      await expect(
        bridge.processTransfer(
          sender.address,
          recipient.address,
          amount,
          chainId,
          [invalidSignature, invalidSignature]
        )
      ).to.be.revertedWith("Invalid signature: zero address");
    });
  });

  describe("EIP-712 Domain Separator", function () {
    it("should have correct domain separator", async function () {
      const chainId = await ethers.provider.getNetwork().then((n) => n.chainId);
      const expectedDomainSeparator = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["bytes32", "bytes32", "bytes32", "uint256", "address"],
          [
            ethers.utils.keccak256(
              ethers.utils.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
            ),
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes("CrossChainBridge")),
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes("1")),
            chainId,
            bridge.address,
          ]
        )
      );

      expect(await bridge.domainSeparator()).to.equal(expectedDomainSeparator);
    });
  });
});
