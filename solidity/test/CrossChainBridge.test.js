const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let bridge;
  let token;
  let owner;
  let validator;
  let recipient;
  let user;

  beforeEach(async function () {
    [owner, validator, recipient, user] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("GovernanceToken");
    token = await Token.deploy(ethers.parseEther("1000000"));

    const Bridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await Bridge.deploy(token.target, validator.address);

    // Fund the bridge pool with some tokens
    await token.transfer(bridge.target, ethers.parseEther("1000"));
  });

  it("Should process a valid transfer with signature and prevent replay", async function () {
    const amount = ethers.parseEther("10");
    const nonce = 1;
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const hash = ethers.solidityPackedKeccak256(
      ["address", "uint256", "uint256", "uint256", "address"],
      [recipient.address, amount, nonce, chainId, bridge.target]
    );

    // Sign the hash with the validator's key
    const messageHashBytes = ethers.getBytes(hash);
    const signature = await validator.signMessage(messageHashBytes);

    // Verify initial recipient balance
    expect(await token.balanceOf(recipient.address)).to.equal(0);

    // Process first transfer
    await expect(bridge.processTransfer(recipient.address, amount, nonce, signature))
      .to.emit(bridge, "TransferProcessed");

    expect(await token.balanceOf(recipient.address)).to.equal(amount);

    // Replay attack on the same contract should fail
    await expect(
      bridge.processTransfer(recipient.address, amount, nonce, signature)
    ).to.be.revertedWith("Already processed");
  });

  it("Should fail replay attack with different chainId, contract address or non-validator signature", async function () {
    const amount = ethers.parseEther("10");
    const nonce = 2;
    const chainId = (await ethers.provider.getNetwork()).chainId;

    // Correct signature
    const hash = ethers.solidityPackedKeccak256(
      ["address", "uint256", "uint256", "uint256", "address"],
      [recipient.address, amount, nonce, chainId, bridge.target]
    );
    const signature = await validator.signMessage(ethers.getBytes(hash));

    // Try processing with incorrect contract address inside the hash
    const fakeBridgeAddress = ethers.Wallet.createRandom().address;
    const hashFakeBridge = ethers.solidityPackedKeccak256(
      ["address", "uint256", "uint256", "uint256", "address"],
      [recipient.address, amount, nonce, chainId, fakeBridgeAddress]
    );
    const signatureFakeBridge = await validator.signMessage(ethers.getBytes(hashFakeBridge));

    await expect(
      bridge.processTransfer(recipient.address, amount, nonce, signatureFakeBridge)
    ).to.be.revertedWith("Invalid signature");

    // Try processing with correct hash but user signature instead of validator
    const userSignature = await user.signMessage(ethers.getBytes(hash));
    await expect(
      bridge.processTransfer(recipient.address, amount, nonce, userSignature)
    ).to.be.revertedWith("Invalid signature");
  });
});
