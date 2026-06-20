const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let bridge, bridgeToken, validator, user, recipient;
  let validatorSigner;

  beforeEach(async function () {
    [validator, user, recipient] = await ethers.getSigners();
    validatorSigner = validator;

    const MockToken = await ethers.getContractFactory("MockERC20");
    bridgeToken = await MockToken.deploy("Bridge Token", "BRG");
    await bridgeToken.deployed();

    const CrossChainBridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await CrossChainBridge.deploy(bridgeToken.address, validator.address);
    await bridge.deployed();
  });

  describe("Signature Verification", function () {
    it("should reject invalid signature length", async function () {
      const invalidSignature = "0x1234";
      await expect(
        bridge.verifySignature(ethers.constants.HashZero, invalidSignature)
      ).to.be.revertedWith("Invalid signature length");
    });

    it("should reject zero-address signature recovery", async function () {
      const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));
      const invalidSignature = ethers.utils.arrayify(
        ethers.utils.hexConcat([
          "0x0000000000000000000000000000000000000000000000000000000000000001",
          "0x0000000000000000000000000000000000000000000000000000000000000001",
          "0x1b"
        ])
      );
      
      // This should fail because ecrecover returns address(0)
      const result = await bridge.verifySignature(hash, invalidSignature);
      expect(result).to.equal(false);
    });
  });

  describe("Transfer Processing", function () {
    it("should prevent same-chain replay", async function () {
      const amount = ethers.utils.parseEther("100");
      await bridgeToken.mint(bridge.address, amount);

      const transferHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256", "uint256"],
          [recipient.address, amount, 0]
        )
      );

      const signature = await validatorSigner.signMessage(
        ethers.utils.arrayify(transferHash)
      );

      await bridge.processTransfer(recipient.address, amount, 0, signature);

      // Try to replay - should fail
      await expect(
        bridge.processTransfer(recipient.address, amount, 0, signature)
      ).to.be.revertedWith("Already processed");
    });
  });

  describe("EIP-712 Verification", function () {
    it("should verify EIP-712 signatures", async function () {
      const amount = ethers.utils.parseEther("100");
      await bridgeToken.mint(bridge.address, amount);

      const structHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["bytes32", "address", "uint256", "uint256", "uint256", "address"],
          [
            await bridge.TRANSFER_TYPEHASH(),
            recipient.address,
            amount,
            0,
            (await ethers.provider.getNetwork()).chainId,
            bridge.address
          ]
        )
      );

      const domainSeparator = await bridge.DOMAIN_SEPARATOR();
      const digest = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["bytes2", "bytes32", "bytes32"],
          ["0x1901", domainSeparator, structHash]
        )
      );

      const signature = await validatorSigner.signMessage(
        ethers.utils.arrayify(digest)
      );

      await bridge.processTransfer(recipient.address, amount, 0, signature);
      expect(await bridge.processedTransfers(ethers.utils.keccak256(ethers.utils.arrayify(digest)))).to.equal(true);
    });
  });
});
