const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge", function () {
  let bridge;
  let owner;
  let user;
  let chainId;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    chainId = (await ethers.provider.getNetwork()).chainId;

    const CrossChainBridge = await ethers.getContractFactory("CrossChainBridge");
    bridge = await CrossChainBridge.deploy();
  });

  it("should prevent cross-chain replay using EIP-712 and chainId", async function () {
    const domain = {
      name: "CrossChainBridge",
      version: "1",
      chainId: chainId,
      verifyingContract: bridge.address
    };

    const types = {
      Transfer: [
        { name: "sender", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" }
      ]
    };

    const value = {
      sender: user.address,
      amount: ethers.utils.parseEther("1"),
      nonce: 0
    };

    const signature = await user._signTypedData(domain, types, value);
    
    // Valid on this chain
    await expect(bridge.bridgeAsset(user.address, value.amount, value.nonce, signature))
      .to.emit(bridge, "BridgeInitiated");

    // Replay on same chain fails due to nonce
    await expect(bridge.bridgeAsset(user.address, value.amount, value.nonce, signature))
      .to.be.revertedWith("Nonce already used");

    // Replay on different chain (simulated by using different chainId in domain)
    const otherDomain = { ...domain, chainId: 999 };
    const otherSignature = await user._signTypedData(otherDomain, types, value);
    
    // This should fail if we try to verify it with current chain's domain separator
    await expect(bridge.bridgeAsset(user.address, value.amount, value.nonce, otherSignature))
      .to.be.revertedWith("Invalid signature");
  });
});
