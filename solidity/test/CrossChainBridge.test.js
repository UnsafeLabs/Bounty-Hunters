const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge Replay Protection", function () {
    let bridge;
    let token;
    let validator;
    let user;
    let domain;
    let types;

    beforeEach(async function () {
        [validator, user] = await ethers.getSigners();
        
        const Token = await ethers.getContractFactory("MockERC20");
        token = await Token.deploy("Mock", "MCK", 18);
        
        const Bridge = await ethers.getContractFactory("CrossChainBridge");
        bridge = await Bridge.deploy(token.address, validator.address);
        
        domain = {
            name: "CrossChainBridge",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: bridge.address
        };

        types = {
            Transfer: [
                { name: "recipient", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "nonce", type: "uint256" }
            ]
        };
    });

    it("Should prevent cross-chain replay via chainId in EIP-712 domain", async function () {
        const amount = ethers.utils.parseEther("100");
        const nonce = 0;
        const value = { recipient: user.address, amount, nonce };

        const signature = await validator._signTypedData(domain, types, value);

        // Success on current chain
        await expect(bridge.processTransfer(user.address, amount, nonce, signature))
            .to.emit(bridge, "TransferProcessed");

        // Fail if chainId was different (simulated by EIP-712 domain mismatch)
        const wrongDomain = { ...domain, chainId: 999 };
        const wrongSig = await validator._signTypedData(wrongDomain, types, value);
        
        await expect(bridge.processTransfer(user.address, amount, nonce, wrongSig))
            .to.be.revertedWith("Invalid signature");
    });

    it("Should prevent same-chain replay via nonces", async function () {
        const amount = ethers.utils.parseEther("100");
        const nonce = 0;
        const value = { recipient: user.address, amount, nonce };

        const signature = await validator._signTypedData(domain, types, value);

        await bridge.processTransfer(user.address, amount, nonce, signature);

        // Replay attempt
        await expect(bridge.processTransfer(user.address, amount, nonce, signature))
            .to.be.revertedWith("Already processed");
    });

    it("Should reject invalid signatures (zero address recovery)", async function () {
        const amount = ethers.utils.parseEther("100");
        const nonce = 0;
        const invalidSig = "0x" + "00".repeat(65);

        await expect(bridge.processTransfer(user.address, amount, nonce, invalidSig))
            .to.be.revertedWith("Invalid signature recovery");
    });
});
