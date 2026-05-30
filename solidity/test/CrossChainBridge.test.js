const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let bridge, token, validator, deployer, recipient, attacker;
  const CHAIN_ID = 31337;

  function hashTransfer(recipient, amount, senderNonce, contractAddr, chainId) {
    const TRANSFER_TYPEHASH = ethers.keccak256(
      ethers.toUtf8Bytes("Transfer(address recipient,uint256 amount,uint256 nonce,address contractAddress,uint256 chainId)")
    );

    const DOMAIN_SEPARATOR = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32", "bytes32", "uint256", "address"],
        [
          ethers.keccak256(
            ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
          ),
          ethers.keccak256(ethers.toUtf8Bytes("CrossChainBridge")),
          ethers.keccak256(ethers.toUtf8Bytes("1")),
          chainId,
          contractAddr
        ]
      )
    );

    const structHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "uint256", "uint256", "address", "uint256"],
        [TRANSFER_TYPEHASH, recipient, amount, senderNonce, contractAddr, chainId]
      )
    );

    const typedDataHash = ethers.keccak256(
      ethers.solidityPacked(
        ["bytes1", "bytes1", "bytes32", "bytes32"],
        ["0x19", "0x01", DOMAIN_SEPARATOR, structHash]
      )
    );

    return ethers.solidityPackedKeccak256(
      ["string", "bytes32"],
      ["\x19Ethereum Signed Message:\n32", typedDataHash]
    );
  }

  async function signTransfer(validatorSigner, recipient, amount, senderNonce, contractAddr, chainId) {
    const msgHash = hashTransfer(recipient, amount, senderNonce, contractAddr, chainId);
    const sig = await validatorSigner.signMessage(ethers.getBytes(msgHash));
    return sig;
  }

  beforeEach(async function () {
    [deployer, validator, recipient, attacker] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("BridgeToken", "BTK", ethers.parseEther("1000000"));
    await token.waitForDeployment();

    const CrossChainBridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await CrossChainBridge.deploy(await token.getAddress(), await validator.getAddress());
    await bridge.waitForDeployment();

    await token.transfer(recipient, ethers.parseEther("10000"));
    await token.connect(recipient).approve(await bridge.getAddress(), ethers.parseEther("10000"));
  });

  describe("EIP-712 typed data signing", function () {
    it("should accept a valid EIP-712 signed transfer", async function () {
      const amount = ethers.parseEther("100");
      await bridge.connect(recipient).initiateTransfer(amount, 1);

      const sig = await signTransfer(
        validator,
        await recipient.getAddress(),
        amount,
        0,
        await bridge.getAddress(),
        CHAIN_ID
      );

      await expect(
        bridge.processTransfer(await recipient.getAddress(), amount, 0, sig)
      ).to.emit(bridge, "TransferProcessed");
    });
  });

  describe("Cross-chain replay prevention", function () {
    it("should reject a signature signed for a different chain ID", async function () {
      const amount = ethers.parseEther("100");
      await bridge.connect(recipient).initiateTransfer(amount, 1);

      const WRONG_CHAIN_ID = 999;
      const sig = await signTransfer(
        validator,
        await recipient.getAddress(),
        amount,
        0,
        await bridge.getAddress(),
        WRONG_CHAIN_ID
      );

      await expect(
        bridge.processTransfer(await recipient.getAddress(), amount, 0, sig)
      ).to.be.revertedWith("Invalid signature");
    });
  });

  describe("Same-chain replay prevention", function () {
    it("should reject a replayed transfer using the same nonce", async function () {
      const amount = ethers.parseEther("100");
      await token.connect(recipient).approve(await bridge.getAddress(), amount.mul(2));
      await bridge.connect(recipient).initiateTransfer(amount, 1);

      const sig = await signTransfer(
        validator,
        await recipient.getAddress(),
        amount,
        0,
        await bridge.getAddress(),
        CHAIN_ID
      );

      await bridge.processTransfer(await recipient.getAddress(), amount, 0, sig);

      await token.mint(await bridge.getAddress(), amount);

      await expect(
        bridge.processTransfer(await recipient.getAddress(), amount, 0, sig)
      ).to.be.revertedWith("Already processed");
    });
  });

  describe("Post-upgrade replay prevention", function () {
    it("should reject a signature intended for a different contract address", async function () {
      const amount = ethers.parseEther("100");
      await bridge.connect(recipient).initiateTransfer(amount, 1);

      const wrongContract = await attacker.getAddress();
      const sig = await signTransfer(
        validator,
        await recipient.getAddress(),
        amount,
        0,
        wrongContract,
        CHAIN_ID
      );

      await expect(
        bridge.processTransfer(await recipient.getAddress(), amount, 0, sig)
      ).to.be.revertedWith("Invalid signature");
    });
  });

  describe("Invalid signature handling", function () {
    it("should reject an invalid signature from a non-validator", async function () {
      const amount = ethers.parseEther("100");
      await bridge.connect(recipient).initiateTransfer(amount, 1);

      const msgHash = hashTransfer(
        await recipient.getAddress(),
        amount,
        0,
        await bridge.getAddress(),
        CHAIN_ID
      );
      const sig = await attacker.signMessage(ethers.getBytes(msgHash));

      await expect(
        bridge.processTransfer(await recipient.getAddress(), amount, 0, sig)
      ).to.be.revertedWith("Invalid signature");
    });

    it("should reject a zero-address recovered signer", async function () {
      const amount = ethers.parseEther("100");
      await bridge.connect(recipient).initiateTransfer(amount, 1);

      const fakeSignature = ethers.hexlify(
        ethers.concat([
          ethers.zeroPadValue("0x00", 32),
          ethers.zeroPadValue("0x00", 32),
          ethers.zeroPadValue("0x1b", 1)
        ])
      );

      await expect(
        bridge.processTransfer(await recipient.getAddress(), amount, 0, fakeSignature)
      ).to.be.revertedWith("Invalid signer: zero address");
    });
  });

  describe("Nonce queryability", function () {
    it("should return the correct nonce per sender", async function () {
      expect(await bridge.getNonce(await recipient.getAddress())).to.equal(0);

      const amount = ethers.parseEther("100");
      await token.connect(recipient).approve(await bridge.getAddress(), amount.mul(2));
      await bridge.connect(recipient).initiateTransfer(amount, 1);

      const sig = await signTransfer(
        validator,
        await recipient.getAddress(),
        amount,
        0,
        await bridge.getAddress(),
        CHAIN_ID
      );

      await bridge.processTransfer(await recipient.getAddress(), amount, 0, sig);
      expect(await bridge.getNonce(await recipient.getAddress())).to.equal(1);
    });
  });
});
