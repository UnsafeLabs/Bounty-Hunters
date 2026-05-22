const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge Vulnerability Reproduction", function () {
  let bridge;
  let token;
  let validator;
  let user;
  let otherUser;

  beforeEach(async function () {
    [validator, user, otherUser] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockToken");
    token = await Token.deploy("Test Token", "TEST", ethers.parseEther("1000"));

    const Bridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await Bridge.deploy(await token.getAddress(), validator.address);

    await token.transfer(await bridge.getAddress(), ethers.parseEther("500"));
  });

  it("Vulnerability: Cross-chain replay is possible", async function () {
    const amount = ethers.parseEther("10");
    const nonce = 0;
    
    // Hash as implemented in vulnerable contract
    const hash = ethers.solidityPackedKeccak256(
      ["address", "uint256", "uint256"],
      [user.address, amount, nonce]
    );
    
    // signMessage adds the "\x19Ethereum Signed Message:\n32" prefix
    const signature = await validator.signMessage(ethers.toBeArray(hash));

    // Process on first bridge instance
    await bridge.processTransfer(user.address, amount, nonce, signature);
    expect(await token.balanceOf(user.address)).to.equal(amount);

    // Now simulate a second chain or re-deployment
    const bridge2 = await (await ethers.getContractFactory("CrossChainBridge")).deploy(
        await token.getAddress(), validator.address
    );
    await token.transfer(await bridge2.getAddress(), ethers.parseEther("500"));

    // User REPLAYS the same signature on bridge2!
    await bridge2.processTransfer(user.address, amount, nonce, signature);
    expect(await token.balanceOf(user.address)).to.equal(amount * 2n);
  });

  it("Vulnerability: No check for ecrecover zero address", async function () {
    const amount = ethers.parseEther("10");
    const nonce = 1;
    
    // Construct an invalid signature (e.g. all zeros)
    // Most valid signatures don't return 0, but some specially crafted ones do.
    // However, the main point is that if it returns 0, and validator happens to be 0 (unlikely but possible in some configs), it would pass.
    // More importantly, it's a known vulnerability.
    
    // We can't easily make ecrecover return 0 with a random signature without trying many.
    // But we can check that a signature that is invalid length or something is handled.
    const invalidSignature = "0x" + "00".repeat(65);
    
    // The current contract should revert because of require(signature.length == 65)
    // but if we pass 65 bytes of zeros, ecrecover returns 0.
    
    // If validator was address(0), this would pass.
    // In our test, validator is signers[0], so it should fail.
    await expect(bridge.processTransfer(user.address, amount, nonce, invalidSignature))
        .to.be.revertedWith("Invalid signature");
  });
});
