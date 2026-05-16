const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const bridgePath = path.join(__dirname, "..", "contracts", "CrossChainBridge.sol");

const ierc20Source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
`;

const mockSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockERC20 {
    string public name = "Mock Token";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
`;

const transferTypes = {
    BridgeTransfer: [
        { name: "sender", type: "address" },
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "chainId", type: "uint256" },
        { name: "bridge", type: "address" },
    ],
};

function compileContracts() {
    const input = {
        language: "Solidity",
        sources: {
            "solidity/contracts/CrossChainBridge.sol": {
                content: fs.readFileSync(bridgePath, "utf8"),
            },
            "@openzeppelin/contracts/token/ERC20/IERC20.sol": {
                content: ierc20Source,
            },
            "solidity/test/BridgeMocks.sol": {
                content: mockSource,
            },
        },
        settings: {
            evmVersion: "shanghai",
            outputSelection: {
                "*": {
                    "*": ["abi", "evm.bytecode.object"],
                },
            },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
    assert.deepEqual(errors, []);
    return output.contracts;
}

function artifact(contracts, source, name) {
    const contract = contracts[source][name];
    return {
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
    };
}

async function deploy(factory, ...args) {
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    return contract;
}

async function send(transaction) {
    const response = await transaction;
    return response.wait();
}

async function setup({ chainId = 31_337, validator = ethers.Wallet.createRandom() } = {}) {
    const provider = new ethers.BrowserProvider(
        ganache.provider({ chain: { chainId }, logging: { quiet: true }, wallet: { totalAccounts: 3 } }),
    );
    const owner = await provider.getSigner(0);
    const recipient = await provider.getSigner(1);
    const contracts = compileContracts();

    const tokenFactory = new ethers.ContractFactory(
        artifact(contracts, "solidity/test/BridgeMocks.sol", "MockERC20").abi,
        artifact(contracts, "solidity/test/BridgeMocks.sol", "MockERC20").bytecode,
        owner,
    );
    const token = await deploy(tokenFactory);

    const bridgeFactory = new ethers.ContractFactory(
        artifact(contracts, "solidity/contracts/CrossChainBridge.sol", "CrossChainBridge").abi,
        artifact(contracts, "solidity/contracts/CrossChainBridge.sol", "CrossChainBridge").bytecode,
        owner,
    );
    const bridge = await deploy(bridgeFactory, await token.getAddress(), validator.address);
    await send(token.mint(await bridge.getAddress(), 1_000_000n));

    return { provider, owner, recipient, validator, token, bridge };
}

async function transferValue(provider, bridge, sender, recipient, amount, nonce) {
    const network = await provider.getNetwork();
    return {
        sender,
        recipient,
        amount,
        nonce,
        chainId: network.chainId,
        bridge: await bridge.getAddress(),
    };
}

async function transferDomain(provider, bridge) {
    const network = await provider.getNetwork();
    return {
        name: "CrossChainBridge",
        version: "1",
        chainId: network.chainId,
        verifyingContract: await bridge.getAddress(),
    };
}

async function signTransfer({ provider, bridge, validator, sender, recipient, amount, nonce }) {
    return validator.signTypedData(
        await transferDomain(provider, bridge),
        transferTypes,
        await transferValue(provider, bridge, sender, recipient, amount, nonce),
    );
}

describe("CrossChainBridge", () => {
    it("constructs the EIP-712 domain separator from name, version, chain ID, and bridge address", async () => {
        const { provider, bridge } = await setup();

        assert.equal(
            await bridge.DOMAIN_SEPARATOR(),
            ethers.TypedDataEncoder.hashDomain(await transferDomain(provider, bridge)),
        );
    });

    it("verifies and processes an EIP-712 bridge transfer", async () => {
        const { provider, owner, recipient, validator, token, bridge } = await setup();
        const senderAddress = await owner.getAddress();
        const recipientAddress = await recipient.getAddress();
        const signature = await signTransfer({
            provider,
            bridge,
            validator,
            sender: senderAddress,
            recipient: recipientAddress,
            amount: 500n,
            nonce: 0n,
        });
        const digest = await bridge.toTypedDataHash(
            await bridge.hashTransfer(senderAddress, recipientAddress, 500n, 0n),
        );

        assert.equal(await bridge.verifySignature(digest, signature), true);
        await send(bridge.processTransfer(senderAddress, recipientAddress, 500n, 0n, signature));

        assert.equal(await token.balanceOf(recipientAddress), 500n);
        assert.equal(await bridge.getNonce(senderAddress), 1n);
    });

    it("rejects same-chain replay with the same nonce and signature", async () => {
        const { provider, owner, recipient, validator, token, bridge } = await setup();
        const senderAddress = await owner.getAddress();
        const recipientAddress = await recipient.getAddress();
        const signature = await signTransfer({
            provider,
            bridge,
            validator,
            sender: senderAddress,
            recipient: recipientAddress,
            amount: 250n,
            nonce: 0n,
        });

        await send(bridge.processTransfer(senderAddress, recipientAddress, 250n, 0n, signature));
        await assert.rejects(send(bridge.processTransfer(senderAddress, recipientAddress, 250n, 0n, signature)));

        assert.equal(await token.balanceOf(recipientAddress), 250n);
        assert.equal(await bridge.getNonce(senderAddress), 1n);
    });

    it("rejects replay against a replacement bridge contract on the same chain", async () => {
        const { provider, owner, recipient, validator, token, bridge } = await setup();
        const senderAddress = await owner.getAddress();
        const recipientAddress = await recipient.getAddress();
        const signature = await signTransfer({
            provider,
            bridge,
            validator,
            sender: senderAddress,
            recipient: recipientAddress,
            amount: 100n,
            nonce: 0n,
        });

        const contracts = compileContracts();
        const bridgeFactory = new ethers.ContractFactory(
            artifact(contracts, "solidity/contracts/CrossChainBridge.sol", "CrossChainBridge").abi,
            artifact(contracts, "solidity/contracts/CrossChainBridge.sol", "CrossChainBridge").bytecode,
            owner,
        );
        const replacementBridge = await deploy(bridgeFactory, await token.getAddress(), validator.address);
        await send(token.mint(await replacementBridge.getAddress(), 1_000n));

        await assert.rejects(send(replacementBridge.processTransfer(senderAddress, recipientAddress, 100n, 0n, signature)));
    });

    it("rejects replay on a different chain ID", async () => {
        const validator = ethers.Wallet.createRandom();
        const source = await setup({ chainId: 31_337, validator });
        const destination = await setup({ chainId: 31_338, validator });
        const senderAddress = await source.owner.getAddress();
        const recipientAddress = await destination.recipient.getAddress();
        const signature = await signTransfer({
            provider: source.provider,
            bridge: source.bridge,
            validator,
            sender: senderAddress,
            recipient: recipientAddress,
            amount: 100n,
            nonce: 0n,
        });

        await assert.rejects(send(destination.bridge.processTransfer(senderAddress, recipientAddress, 100n, 0n, signature)));
    });

    it("rejects zero-address ecrecover results as invalid signatures", async () => {
        const { owner, recipient, bridge } = await setup();
        const senderAddress = await owner.getAddress();
        const recipientAddress = await recipient.getAddress();
        const digest = await bridge.toTypedDataHash(
            await bridge.hashTransfer(senderAddress, recipientAddress, 100n, 0n),
        );
        const zeroSignature = `0x${"00".repeat(65)}`;

        assert.equal(await bridge.verifySignature(digest, zeroSignature), false);
        await assert.rejects(send(bridge.processTransfer(senderAddress, recipientAddress, 100n, 0n, zeroSignature)));
    });

    it("exposes and increments sender nonces when transfers are initiated", async () => {
        const { owner, token, bridge } = await setup();
        const ownerAddress = await owner.getAddress();

        await send(token.mint(ownerAddress, 1_000n));
        await send(token.approve(await bridge.getAddress(), 1_000n));
        await send(bridge.initiateTransfer(100n, 2n));

        assert.equal(await bridge.getNonce(ownerAddress), 1n);
        assert.equal(await bridge.nonces(ownerAddress), 1n);
    });
});
