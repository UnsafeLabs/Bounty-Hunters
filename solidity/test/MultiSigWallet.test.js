const assert = require("node:assert/strict");
const { beforeEach, describe, it } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const walletPath = path.join(__dirname, "..", "contracts", "MultiSigWallet.sol");
const zeroAddress = "0x0000000000000000000000000000000000000000";

const helperSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMultiSigWallet {
    function confirmTransaction(uint256 txId) external;
    function revokeConfirmation(uint256 txId) external;
}

contract RevokingOwner {
    address public wallet;
    uint256 public txId;

    function configure(address _wallet, uint256 _txId) external {
        wallet = _wallet;
        txId = _txId;
    }

    function confirm() external {
        IMultiSigWallet(wallet).confirmTransaction(txId);
    }

    function triggerRevoke() external payable {
        IMultiSigWallet(wallet).revokeConfirmation(txId);
    }
}

contract NoopTarget {
    uint256 public calls;

    function ping() external payable {
        calls++;
    }
}
`;

function compileContracts() {
    const input = {
        language: "Solidity",
        sources: {
            "solidity/contracts/MultiSigWallet.sol": {
                content: fs.readFileSync(walletPath, "utf8"),
            },
            "solidity/test/MultiSigHelpers.sol": {
                content: helperSource,
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

async function submit(wallet, signer, to, value = 0n, data = "0x") {
    const txId = await wallet.transactionCount();
    await send(wallet.connect(signer).submitTransaction(to, value, data));
    return txId;
}

describe("MultiSigWallet", () => {
    let provider;
    let ownerA;
    let ownerB;
    let ownerC;
    let recipient;
    let contracts;
    let wallet;

    beforeEach(async () => {
        provider = new ethers.BrowserProvider(
            ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 5 } }),
        );
        ownerA = await provider.getSigner(0);
        ownerB = await provider.getSigner(1);
        ownerC = await provider.getSigner(2);
        recipient = await provider.getSigner(3);
        contracts = compileContracts();

        const walletFactory = new ethers.ContractFactory(
            artifact(contracts, "solidity/contracts/MultiSigWallet.sol", "MultiSigWallet").abi,
            artifact(contracts, "solidity/contracts/MultiSigWallet.sol", "MultiSigWallet").bytecode,
            ownerA,
        );
        wallet = await deploy(walletFactory, [
            await ownerA.getAddress(),
            await ownerB.getAddress(),
            await ownerC.getAddress(),
        ], 2);

        await send(ownerA.sendTransaction({ to: await wallet.getAddress(), value: 1_000_000n }));
    });

    it("supports submit, confirm, execute, and revoke for normal flows under the gas target", async () => {
        const recipientAddress = await recipient.getAddress();
        const txId = await submit(wallet, ownerA, recipientAddress, 100n);

        await send(wallet.connect(ownerA).confirmTransaction(txId));
        await send(wallet.connect(ownerB).confirmTransaction(txId));
        const receipt = await send(wallet.connect(ownerA).executeTransaction(txId));

        assert.equal((await wallet.transactions(txId)).executed, true);
        assert.equal(await provider.getBalance(await wallet.getAddress()), 999_900n);
        assert.ok(receipt.gasUsed < 100_000n, `gas used ${receipt.gasUsed}`);

        const revokeTxId = await submit(wallet, ownerA, recipientAddress, 1n);
        await send(wallet.connect(ownerA).confirmTransaction(revokeTxId));
        assert.equal(await wallet.getConfirmationCount(revokeTxId), 1n);
        await send(wallet.connect(ownerA).revokeConfirmation(revokeTxId));
        assert.equal(await wallet.getConfirmationCount(revokeTxId), 0n);
    });

    it("rejects zero-address targets and calldata sent to EOAs", async () => {
        const recipientAddress = await recipient.getAddress();

        await assert.rejects(send(wallet.connect(ownerA).submitTransaction(zeroAddress, 0n, "0x")));
        await assert.rejects(send(wallet.connect(ownerA).submitTransaction(recipientAddress, 0n, "0x1234")));
    });

    it("blocks execution when a confirmation is revoked before execution", async () => {
        const recipientAddress = await recipient.getAddress();
        const txId = await submit(wallet, ownerA, recipientAddress, 100n);

        await send(wallet.connect(ownerA).confirmTransaction(txId));
        const confirmationReceipt = await send(wallet.connect(ownerB).confirmTransaction(txId));
        const confirmationBlock = confirmationReceipt.blockNumber;

        await send(wallet.connect(ownerB).revokeConfirmation(txId));

        assert.equal(await wallet.isConfirmedAtBlock(txId, await ownerB.getAddress(), confirmationBlock), true);
        assert.equal(await wallet.isConfirmedAtBlock(txId, await ownerB.getAddress(), await provider.getBlockNumber()), false);
        await assert.rejects(send(wallet.connect(ownerA).executeTransaction(txId)));
    });

    it("reverts if a contract owner revokes its confirmation during the execution callback", async () => {
        const revokerFactory = new ethers.ContractFactory(
            artifact(contracts, "solidity/test/MultiSigHelpers.sol", "RevokingOwner").abi,
            artifact(contracts, "solidity/test/MultiSigHelpers.sol", "RevokingOwner").bytecode,
            ownerA,
        );
        const revoker = await deploy(revokerFactory);

        const walletFactory = new ethers.ContractFactory(
            artifact(contracts, "solidity/contracts/MultiSigWallet.sol", "MultiSigWallet").abi,
            artifact(contracts, "solidity/contracts/MultiSigWallet.sol", "MultiSigWallet").bytecode,
            ownerA,
        );
        const callbackWallet = await deploy(walletFactory, [
            await ownerA.getAddress(),
            await ownerB.getAddress(),
            await revoker.getAddress(),
        ], 2);

        const txId = await submit(
            callbackWallet,
            ownerA,
            await revoker.getAddress(),
            0n,
            revoker.interface.encodeFunctionData("triggerRevoke"),
        );
        await send(revoker.configure(await callbackWallet.getAddress(), txId));
        await send(callbackWallet.connect(ownerA).confirmTransaction(txId));
        await send(revoker.confirm());

        await assert.rejects(send(callbackWallet.connect(ownerA).executeTransaction(txId)));
        assert.equal((await callbackWallet.transactions(txId)).executed, false);
        assert.equal(await callbackWallet.getConfirmationCount(txId), 2n);
    });

    it("allows calldata submissions to contract targets", async () => {
        const targetFactory = new ethers.ContractFactory(
            artifact(contracts, "solidity/test/MultiSigHelpers.sol", "NoopTarget").abi,
            artifact(contracts, "solidity/test/MultiSigHelpers.sol", "NoopTarget").bytecode,
            ownerA,
        );
        const target = await deploy(targetFactory);
        const txId = await submit(
            wallet,
            ownerA,
            await target.getAddress(),
            0n,
            target.interface.encodeFunctionData("ping"),
        );

        await send(wallet.connect(ownerA).confirmTransaction(txId));
        await send(wallet.connect(ownerB).confirmTransaction(txId));
        await send(wallet.connect(ownerA).executeTransaction(txId));

        assert.equal(await target.calls(), 1n);
    });
});
