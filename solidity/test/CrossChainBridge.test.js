const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainBridge Replay Protection", function () {
    let bridge;
    let token;
    let owner;
    let validator;
    let user;
    let chainId;

    beforeEach(async function () {
        [owner, validator, user] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        const Token = await ethers.getContractFactory("MockERC20");
        token = await Token.deploy("Bridge Token", "BRG", 18);

        const Bridge = await ethers.getContractFactory("CrossChainBridge");
        bridge = await Bridge.deploy(token.address, validator.address);

        await token.transfer(bridge.address, ethers.utils.parseEther("1000"));
    });

    async function getSignature(recipient, amount, nonce, bridgeAddress, currentChainId) {
        const domain = {
            name: "CrossChainBridge",
            version: "1",
            chainId: currentChainId,
            verifyingContract: bridgeAddress
        };

        const types = {
            Transfer: [
                { name: "recipient", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "nonce", type: "uint256" }
            ]
        };

        const value = {
            recipient: recipient,
            amount: amount,
            nonce: nonce
        };

        return await validator._signTypedData(domain, types, value);
    }

    it("Should process a valid transfer with correct signature", async function () {
        const amount = ethers.utils.parseEther("10");
        const nonce = await bridge.nonces(user.address);
        const signature = await getSignature(user.address, amount, nonce, bridge.address, chainId);

        await expect(bridge.processTransfer(user.address, amount, nonce, signature))
            .to.emit(bridge, "TransferProcessed");
        
        expect(await token.balanceOf(user.address)).to.equal(amount);
    });

    it("Should prevent same-chain replay using nonces", async function () {
        const amount = ethers.utils.parseEther("10");
        const nonce = await bridge.nonces(user.address);
        const signature = await getSignature(user.address, amount, nonce, bridge.address, chainId);

        await bridge.processTransfer(user.address, amount, nonce, signature);

        // Attempt to replay the same signature
        await expect(bridge.processTransfer(user.address, amount, nonce, signature))
            .to.be.revertedWith("Already processed");
    });

    it("Should prevent cross-chain replay by including chainId", async function () {
        const amount = ethers.utils.parseEther("10");
        const nonce = await bridge.nonces(user.address);
        const wrongChainId = chainId + 1;
        const signature = await getSignature(user.address, amount, nonce, bridge.address, wrongChainId);

        await expect(bridge.processTransfer(user.address, amount, nonce, signature))
            .to.be.revertedWith("Invalid signature");
    });

    it("Should prevent replay after upgrade by including contract address", async function () {
        const amount = ethers.utils.parseEther("10");
        const nonce = await bridge.nonces(user.address);
        
        // Deploy a "new" bridge at a different address
        const Bridge = await ethers.getContractFactory("CrossChainBridge");
        const bridgeV2 = await Bridge.deploy(token.address, validator.address);
        
        const signatureForV1 = await getSignature(user.address, amount, nonce, bridge.address, chainId);

        await expect(bridgeV2.processTransfer(user.address, amount, nonce, signatureForV1))
            .to.be.revertedWith("Invalid signature");
    });

    it("Should reject invalid signature (zero address recovery)", async function () {
        const amount = ethers.utils.parseEther("10");
        const nonce = 0;
        // Random 65 bytes signature that might cause ecrecover to return 0 or fail
        const invalidSignature = "0x" + "00".repeat(65);

        await expect(bridge.processTransfer(user.address, amount, nonce, invalidSignature))
            .to.be.revertedWith("Invalid signature length"); // Because our assembly check for length 65 passes but v is 0
    });

    it("Should expose nonces per user", async function () {
        expect(await bridge.nonces(user.address)).to.equal(0);
        
        // We need to initiate a transfer to increment local nonce (if the contract does that)
        // Note: in our fix, initiateTransfer increments nonces[msg.sender]
        await token.transfer(user.address, 100);
        await token.connect(user).approve(bridge.address, 100);
        await bridge.connect(user).initiateTransfer(user.address, 100, 1);
        
        expect(await bridge.nonces(user.address)).to.equal(1);
    });
});
