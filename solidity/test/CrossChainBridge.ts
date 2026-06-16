import { ethers } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { CrossChainBridge, TestToken } from "../typechain-types";

describe("CrossChainBridge", function () {
    let bridge: CrossChainBridge;
    let token: TestToken;
    let owner: HardhatEthersSigner;
    let user: HardhatEthersSigner;
    let validator: HardhatEthersSigner;

    beforeEach(async function () {
        [owner, user, validator] = await ethers.getSigners();

        const tokenFactory = await ethers.getContractFactory("TestToken");
        token = await tokenFactory.deploy("Test Token", "TST");
        await token.deploymentTransaction()?.wait();
        
        const bridgeFactory = await ethers.getContractFactory("CrossChainBridge");
        bridge = await bridgeFactory.deploy(await token.getAddress(), validator.address);
        await bridge.deploymentTransaction()?.wait();

        await token.mint(user.address, 1000);
    });

    it("Should deploy the contract", async function () {
        expect(bridge.address).to.not.equal(0);
    });

    it("should initiate a transfer", async function () {
        const bridgeAddress = await bridge.getAddress();
        await token.connect(user).approve(bridgeAddress, 100);
        await expect(bridge.connect(user).initiateTransfer(100, 2))
            .to.emit(bridge, "TransferInitiated")
            .withArgs(user.address, 100, 2, 0);
        expect(await token.balanceOf(await bridge.getAddress())).to.equal(100);
    });

    it("should process a valid transfer", async function () {
        await token.connect(owner).mint(await bridge.getAddress(), 100);
        const nonce = await bridge.nonces(user.address);

        const domain = {
            name: "CrossChainBridge",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await bridge.getAddress()
        };

        const types = {
            Transfer: [
                { name: "recipient", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "nonce", type: "uint256" }
            ]
        };

        const value = {
            recipient: user.address,
            amount: 100,
            nonce: nonce
        };

        const signature = await validator.signTypedData(domain, types, value);

        await expect(bridge.connect(owner).processTransfer(user.address, 100, nonce, signature))
            .to.emit(bridge, "TransferProcessed");
        
        expect(await token.balanceOf(user.address)).to.equal(1100);
    });

    it("should reject an invalid signature", async function () {
        await token.connect(owner).mint(await bridge.getAddress(), 100);
        const nonce = await bridge.nonces(user.address);

        const domain = {
            name: "CrossChainBridge",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await bridge.getAddress()
        };

        const types = {
            Transfer: [
                { name: "recipient", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "nonce", type: "uint256" }
            ]
        };

        const value = {
            recipient: user.address,
            amount: 100,
            nonce: nonce
        };

        const signature = await user.signTypedData(domain, types, value);

        await expect(bridge.connect(owner).processTransfer(user.address, 100, nonce, signature))
            .to.be.revertedWith("Invalid signature");
    });

    it("should reject same-chain replay", async function () {
        await token.connect(owner).mint(await bridge.getAddress(), 200);
        const nonce = await bridge.nonces(user.address);

        const domain = {
            name: "CrossChainBridge",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await bridge.getAddress()
        };

        const types = {
            Transfer: [
                { name: "recipient", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "nonce", type: "uint256" }
            ]
        };

        const value = {
            recipient: user.address,
            amount: 100,
            nonce: nonce
        };

        const signature = await validator.signTypedData(domain, types, value);

        await bridge.connect(owner).processTransfer(user.address, 100, nonce, signature);

        await expect(bridge.connect(owner).processTransfer(user.address, 100, nonce, signature))
            .to.be.revertedWith("Already processed");
    });

    it("should reject cross-chain replay", async function () {
        await token.connect(owner).mint(await bridge.getAddress(), 100);
        const nonce = await bridge.nonces(user.address);

        const domain = {
            name: "CrossChainBridge",
            version: "1",
            chainId: 2, // Different chain ID
            verifyingContract: await bridge.getAddress()
        };

        const types = {
            Transfer: [
                { name: "recipient", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "nonce", type: "uint256" }
            ]
        };

        const value = {
            recipient: user.address,
            amount: 100,
            nonce: nonce
        };

        const signature = await validator.signTypedData(domain, types, value);

        await expect(bridge.connect(owner).processTransfer(user.address, 100, nonce, signature))
            .to.be.revertedWith("Invalid signature");
    });

    it("should reject post-upgrade replay", async function () {
        await token.connect(owner).mint(await bridge.getAddress(), 100);
        const nonce = await bridge.nonces(user.address);

        const domain = {
            name: "CrossChainBridge",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await bridge.getAddress()
        };

        const types = {
            Transfer: [
                { name: "recipient", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "nonce", type: "uint256" }
            ]
        };

        const value = {
            recipient: user.address,
            amount: 100,
            nonce: nonce
        };

        const signature = await validator.signTypedData(domain, types, value);

        const bridgeFactory = await ethers.getContractFactory("CrossChainBridge");
        const newBridge = await bridgeFactory.deploy(await token.getAddress(), validator.address);
        await newBridge.deploymentTransaction()?.wait();
        await token.connect(owner).mint(await newBridge.getAddress(), 100);

        await expect(newBridge.connect(owner).processTransfer(user.address, 100, nonce, signature))
            .to.be.revertedWith("Invalid signature");
    });
});
