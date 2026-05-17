const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { join } = require("node:path");
const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const callbackSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMultiSigWallet {
    function confirmTransaction(uint256 txId) external;
    function revokeConfirmation(uint256 txId) external;
}

contract CallbackRevoker {
    IMultiSigWallet public wallet;
    uint256 public txId;

    function setWallet(address wallet_) external {
        wallet = IMultiSigWallet(wallet_);
    }

    function setTxId(uint256 txId_) external {
        txId = txId_;
    }

    function confirm(uint256 txId_) external {
        wallet.confirmTransaction(txId_);
    }

    receive() external payable {
        wallet.revokeConfirmation(txId);
    }
}`;

function compileContracts() {
    const walletSource = readFileSync(join(__dirname, "../contracts/MultiSigWallet.sol"), "utf8");
    const input = {
        language: "Solidity",
        sources: {
            "contracts/MultiSigWallet.sol": { content: walletSource },
            "contracts/CallbackRevoker.sol": { content: callbackSource }
        },
        settings: {
            optimizer: { enabled: true, runs: 200 },
            outputSelection: {
                "*": {
                    "*": ["abi", "evm.bytecode.object"]
                }
            }
        }
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
    assert.deepEqual(errors, []);

    return output.contracts;
}

const contracts = compileContracts();

async function createFixture(required = 2) {
    const ganacheProvider = ganache.provider({
        logging: { quiet: true },
        wallet: { totalAccounts: 6, defaultBalance: 1000 }
    });
    const provider = new ethers.BrowserProvider(ganacheProvider);
    const signers = await Promise.all([0, 1, 2, 3, 4, 5].map((index) => provider.getSigner(index)));
    const [ownerA, ownerB, ownerC] = signers;

    const walletArtifact = contracts["contracts/MultiSigWallet.sol"].MultiSigWallet;
    const walletFactory = new ethers.ContractFactory(
        walletArtifact.abi,
        walletArtifact.evm.bytecode.object,
        ownerA
    );
    const wallet = await walletFactory.deploy(
        [await ownerA.getAddress(), await ownerB.getAddress(), await ownerC.getAddress()],
        required
    );
    await wallet.waitForDeployment();
    await (await ownerA.sendTransaction({ to: await wallet.getAddress(), value: ethers.parseEther("10") })).wait();

    return { provider, signers, wallet };
}

async function deployCallbackRevoker(signer) {
    const callbackArtifact = contracts["contracts/CallbackRevoker.sol"].CallbackRevoker;
    const factory = new ethers.ContractFactory(
        callbackArtifact.abi,
        callbackArtifact.evm.bytecode.object,
        signer
    );
    const callback = await factory.deploy();
    await callback.waitForDeployment();
    return callback;
}

async function submitTransaction(wallet, signer, to, value = 0n, data = "0x") {
    const tx = await wallet.connect(signer).submitTransaction(to, value, data);
    await tx.wait();
    return Number((await wallet.transactionCount()) - 1n);
}

async function latestBalance(provider, address) {
    return BigInt(await provider.send("eth_getBalance", [address, "latest"]));
}

async function expectRevert(action, reason) {
    try {
        const tx = await action();
        await tx.wait();
    } catch (error) {
        const message = `${error.shortMessage ?? ""} ${error.message ?? ""}`;
        if (!message.includes("missing revert data") && !message.includes("transaction execution reverted")) {
            assert.match(message, reason);
        }
        return;
    }

    assert.fail("Expected transaction to revert");
}

test("submit, confirm, revoke, reconfirm, and execute a simple transfer under the gas limit", async () => {
    const { provider, signers, wallet } = await createFixture();
    const [ownerA, ownerB, , recipient] = signers;
    const recipientAddress = await recipient.getAddress();

    const txId = await submitTransaction(wallet, ownerA, recipientAddress, ethers.parseEther("1"));
    await (await wallet.connect(ownerA).confirmTransaction(txId)).wait();
    await (await wallet.connect(ownerB).confirmTransaction(txId)).wait();
    assert.equal(await wallet.getConfirmationCount(txId), 2n);

    await (await wallet.connect(ownerB).revokeConfirmation(txId)).wait();
    assert.equal(await wallet.getConfirmationCount(txId), 1n);

    await (await wallet.connect(ownerB).confirmTransaction(txId)).wait();
    const before = await latestBalance(provider, recipientAddress);
    const receipt = await (await wallet.connect(ownerA).executeTransaction(txId)).wait();
    const after = await latestBalance(provider, recipientAddress);

    assert.equal(after - before, ethers.parseEther("1"));
    assert.ok(receipt.gasUsed < 100000n, `executeTransaction used ${receipt.gasUsed} gas`);
    await expectRevert(
        () => wallet.connect(ownerA).executeTransaction(txId),
        /Already executed/
    );
});

test("executeTransaction reverts when a callback revokes a required confirmation", async () => {
    const ganacheProvider = ganache.provider({
        logging: { quiet: true },
        wallet: { totalAccounts: 5, defaultBalance: 1000 }
    });
    const provider = new ethers.BrowserProvider(ganacheProvider);
    const [ownerA, ownerB] = await Promise.all([provider.getSigner(0), provider.getSigner(1)]);
    const callback = await deployCallbackRevoker(ownerA);

    const walletArtifact = contracts["contracts/MultiSigWallet.sol"].MultiSigWallet;
    const walletFactory = new ethers.ContractFactory(
        walletArtifact.abi,
        walletArtifact.evm.bytecode.object,
        ownerA
    );
    const wallet = await walletFactory.deploy(
        [await ownerA.getAddress(), await ownerB.getAddress(), await callback.getAddress()],
        2
    );
    await wallet.waitForDeployment();
    await (await callback.setWallet(await wallet.getAddress())).wait();
    await (await ownerA.sendTransaction({ to: await wallet.getAddress(), value: ethers.parseEther("1") })).wait();

    const txId = await submitTransaction(wallet, ownerA, await callback.getAddress(), ethers.parseEther("0.1"));
    await (await callback.setTxId(txId)).wait();
    await (await wallet.connect(ownerA).confirmTransaction(txId)).wait();
    await (await callback.confirm(txId)).wait();

    await expectRevert(
        () => wallet.connect(ownerA).executeTransaction(txId),
        /Confirmations revoked during execution/
    );
    assert.equal(await wallet.getConfirmationCount(txId), 2n);
});

test("block-level confirmation checks reject a revoked confirmation before execution", async () => {
    const { signers, wallet } = await createFixture();
    const [ownerA, ownerB, , recipient] = signers;
    const ownerBAddress = await ownerB.getAddress();
    const txId = await submitTransaction(wallet, ownerA, await recipient.getAddress(), 1n);

    await (await wallet.connect(ownerA).confirmTransaction(txId)).wait();
    const confirmReceipt = await (await wallet.connect(ownerB).confirmTransaction(txId)).wait();
    assert.equal(await wallet.isConfirmedAtBlock(txId, ownerBAddress, confirmReceipt.blockNumber), true);

    const revokeReceipt = await (await wallet.connect(ownerB).revokeConfirmation(txId)).wait();
    assert.equal(await wallet.isConfirmedAtBlock(txId, ownerBAddress, confirmReceipt.blockNumber), true);
    assert.equal(await wallet.isConfirmedAtBlock(txId, ownerBAddress, revokeReceipt.blockNumber), false);

    await expectRevert(
        () => wallet.connect(ownerA).executeTransaction(txId),
        /Not enough confirmations/
    );
});

test("submitTransaction rejects zero-address targets and calldata to EOAs", async () => {
    const { signers, wallet } = await createFixture();
    const [ownerA, , , recipient] = signers;
    const recipientAddress = await recipient.getAddress();

    await expectRevert(
        () => wallet.connect(ownerA).submitTransaction(ethers.ZeroAddress, 0, "0x"),
        /Invalid target/
    );
    await expectRevert(
        () => wallet.connect(ownerA).submitTransaction(recipientAddress, 0, "0x1234"),
        /Target has no code/
    );
});
