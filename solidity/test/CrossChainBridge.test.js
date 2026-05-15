const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

const NAME = "CrossChainBridge";
const VERSION = "1";
const TRANSFER_TYPES = {
  Transfer: [
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" }
  ]
};

describe("CrossChainBridge", function () {
  async function deployBridge() {
    const [owner, validator, recipient] = await ethers.getSigners();
    const initialSupply = ethers.parseEther("1000000");
    const transferAmount = ethers.parseEther("100");

    const Token = await ethers.getContractFactory("GovernanceToken");
    const token = await Token.deploy(initialSupply);

    const Bridge = await ethers.getContractFactory("CrossChainBridge");
    const bridge = await Bridge.deploy(await token.getAddress(), validator.address);
    await token.transfer(await bridge.getAddress(), ethers.parseEther("10000"));

    return { owner, validator, recipient, token, bridge, transferAmount };
  }

  async function domainFor(bridge, overrides = {}) {
    const network = await ethers.provider.getNetwork();

    return {
      name: NAME,
      version: VERSION,
      chainId: overrides.chainId ?? network.chainId,
      verifyingContract: overrides.verifyingContract ?? await bridge.getAddress()
    };
  }

  async function signTransfer(bridge, signer, recipient, amount, nonce, overrides = {}) {
    return signer.signTypedData(
      await domainFor(bridge, overrides),
      TRANSFER_TYPES,
      { recipient, amount, nonce }
    );
  }

  it("constructs the EIP-712 domain separator with name, version, chain id, and contract address", async function () {
    const { bridge } = await deployBridge();
    const expected = ethers.TypedDataEncoder.hashDomain(await domainFor(bridge));

    assert.equal(await bridge.DOMAIN_SEPARATOR(), expected);
  });

  it("verifies and processes EIP-712 transfer signatures", async function () {
    const { validator, recipient, token, bridge, transferAmount } = await deployBridge();
    const nonce = await bridge.getNonce(recipient.address);
    const signature = await signTransfer(bridge, validator, recipient.address, transferAmount, nonce);
    const digest = ethers.TypedDataEncoder.hash(
      await domainFor(bridge),
      TRANSFER_TYPES,
      { recipient: recipient.address, amount: transferAmount, nonce }
    );

    assert.equal(await bridge.hashTransfer(recipient.address, transferAmount, nonce), digest);
    assert.equal(await bridge.verifySignature(digest, signature), true);

    await bridge.processTransfer(recipient.address, transferAmount, nonce, signature);

    assert.equal(await token.balanceOf(recipient.address), transferAmount);
    assert.equal(await bridge.getNonce(recipient.address), nonce + 1n);
    assert.equal(await bridge.processedTransfers(digest), true);
  });

  it("exposes per-sender nonces for initiated transfers", async function () {
    const { owner, bridge, token, transferAmount } = await deployBridge();
    const bridgeAddress = await bridge.getAddress();

    assert.equal(await bridge.getNonce(owner.address), 0n);
    assert.equal(await bridge.nonces(owner.address), 0n);

    await token.approve(bridgeAddress, transferAmount);
    await bridge.initiateTransfer(transferAmount, 2);

    assert.equal(await bridge.getNonce(owner.address), 1n);
    assert.equal(await bridge.nonces(owner.address), 1n);
  });

  it("rejects the same signed message when replayed on the same chain", async function () {
    const { validator, recipient, bridge, transferAmount } = await deployBridge();
    const nonce = await bridge.getNonce(recipient.address);
    const signature = await signTransfer(bridge, validator, recipient.address, transferAmount, nonce);

    await bridge.processTransfer(recipient.address, transferAmount, nonce, signature);

    await assert.rejects(
      bridge.processTransfer(recipient.address, transferAmount, nonce, signature),
      /Invalid nonce/
    );
  });

  it("rejects a message signed for a different chain", async function () {
    const { validator, recipient, bridge, transferAmount } = await deployBridge();
    const network = await ethers.provider.getNetwork();
    const nonce = await bridge.getNonce(recipient.address);
    const signature = await signTransfer(
      bridge,
      validator,
      recipient.address,
      transferAmount,
      nonce,
      { chainId: network.chainId + 1n }
    );

    await assert.rejects(
      bridge.processTransfer(recipient.address, transferAmount, nonce, signature),
      /Invalid signature/
    );
  });

  it("rejects a message signed for another bridge contract address", async function () {
    const { validator, recipient, token, bridge, transferAmount } = await deployBridge();
    const Bridge = await ethers.getContractFactory("CrossChainBridge");
    const replacementBridge = await Bridge.deploy(await token.getAddress(), validator.address);
    await token.transfer(await replacementBridge.getAddress(), ethers.parseEther("10000"));

    const nonce = await replacementBridge.getNonce(recipient.address);
    const signature = await signTransfer(bridge, validator, recipient.address, transferAmount, nonce);

    await assert.rejects(
      replacementBridge.processTransfer(recipient.address, transferAmount, nonce, signature),
      /Invalid signature/
    );
  });

  it("rejects signatures whose ecrecover result is the zero address", async function () {
    const { recipient, bridge, transferAmount } = await deployBridge();
    const nonce = await bridge.getNonce(recipient.address);
    const digest = await bridge.hashTransfer(recipient.address, transferAmount, nonce);
    const zeroAddressSignature = `0x${"00".repeat(65)}`;

    assert.equal(await bridge.verifySignature(digest, zeroAddressSignature), false);

    await assert.rejects(
      bridge.processTransfer(recipient.address, transferAmount, nonce, zeroAddressSignature),
      /Invalid signature/
    );
  });
});
