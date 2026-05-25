import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { ethers } from "ethers";
import ganache from "ganache";
import solc from "solc";

const root = process.cwd();
const walletPath = path.join(root, "contracts", "MultiSigWallet.sol");

const testContractsSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMultiSigWallet {
    function confirmTransaction(uint256 txId) external;
    function revokeConfirmation(uint256 txId) external;
    function executeTransaction(uint256 txId) external;
}

contract CallbackRevoker {
    IMultiSigWallet public wallet;
    uint256 public txToRevoke;
    bool public revokeAttempted;
    bool public revokeBlocked;

    function setWallet(address wallet_) external {
        require(address(wallet) == address(0), "wallet already set");
        wallet = IMultiSigWallet(wallet_);
    }

    function confirm(uint256 txId) external {
        wallet.confirmTransaction(txId);
    }

    function triggerRevoke(uint256 txId) external {
        txToRevoke = txId;
        revokeAttempted = true;
        (bool ok, ) = address(wallet).call(
            abi.encodeWithSelector(IMultiSigWallet.revokeConfirmation.selector, txId)
        );
        revokeBlocked = !ok;
    }

    function revokeThenExecute(uint256 txId) external {
        wallet.revokeConfirmation(txId);
        wallet.executeTransaction(txId);
    }
}
`;

function compileContracts() {
  const walletSource = readFileSync(walletPath, "utf8");
  const input = {
    language: "Solidity",
    sources: {
      "contracts/MultiSigWallet.sol": {
        content: walletSource,
      },
      "test/CallbackRevoker.sol": {
        content: testContractsSource,
      },
    },
    settings: {
      evmVersion: "paris",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.deepEqual(errors, [], errors.map((error) => error.formattedMessage).join("\n"));

  assert.match(walletSource, /function\s+isConfirmedAtBlock\s*\(/);
  assert.match(walletSource, /require\s*\(\s*to\s*!=\s*address\(0\)/);
  assert.match(walletSource, /Execution in progress|Reentrant/);

  return output.contracts;
}

function artifact(contracts, source, name) {
  const compiled = contracts[source][name];
  return {
    abi: compiled.abi,
    bytecode: `0x${compiled.evm.bytecode.object}`,
  };
}

async function deploy(contracts, signer, source, name, args = []) {
  const { abi, bytecode } = artifact(contracts, source, name);
  const factory = new ethers.ContractFactory(abi, bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function expectRevert(action, pattern = /revert/i) {
  try {
    const result = await action();
    if (result?.wait) {
      await result.wait();
    }
  } catch (error) {
    const message = String(error.shortMessage ?? error.message);
    if (pattern) {
      assert.match(message, pattern);
    } else {
      assert.match(message, /revert|missing revert data|transaction execution reverted/i);
    }
    return;
  }
  assert.fail("Expected revert");
}

function makeProvider() {
  const ganacheProvider = ganache.provider({
    chain: { chainId: 31_337 },
    logging: { quiet: true },
    miner: { blockGasLimit: 30_000_000 },
    wallet: { deterministic: true },
  });
  return {
    ganacheProvider,
    provider: new ethers.BrowserProvider(ganacheProvider),
  };
}

describe("MultiSigWallet", function () {
  let contracts;
  let ganacheProvider;
  let provider;
  let owner0;
  let owner1;
  let owner2;
  let recipient;

  before(async function () {
    contracts = compileContracts();
  });

  beforeEach(async function () {
    ({ ganacheProvider, provider } = makeProvider());
    [owner0, owner1, owner2, recipient] = await Promise.all([
      provider.getSigner(0),
      provider.getSigner(1),
      provider.getSigner(2),
      provider.getSigner(3),
    ]);
  });

  async function deployWallet({ owners, required = 2 } = {}) {
    const walletOwners =
      owners ??
      (await Promise.all([owner0.getAddress(), owner1.getAddress(), owner2.getAddress()]));
    return deploy(contracts, owner0, "contracts/MultiSigWallet.sol", "MultiSigWallet", [
      walletOwners,
      required,
    ]);
  }

  async function submit(wallet, signer, to, value = 0n, data = "0x") {
    const tx = await wallet.connect(signer).submitTransaction(to, value, data);
    const receipt = await tx.wait();
    assert.equal(receipt.status, 1);
    return (await wallet.transactionCount()) - 1n;
  }

  async function fundWallet(wallet, amount = ethers.parseEther("1")) {
    await (
      await owner0.sendTransaction({
        to: await wallet.getAddress(),
        value: amount,
      })
    ).wait();
  }

  it("rejects zero-address transaction targets", async function () {
    const wallet = await deployWallet();

    await expectRevert(() => wallet.submitTransaction(ethers.ZeroAddress, 0n, "0x"), null);
  });

  it("rejects calldata sent to an EOA target", async function () {
    const wallet = await deployWallet();

    await expectRevert(
      () => wallet.submitTransaction(owner1.address, 0n, "0x1234"),
      /Target not contract|missing revert data|transaction execution reverted/i,
    );
  });

  it("keeps the existing submit, confirm, revoke, and execute flows working", async function () {
    const wallet = await deployWallet();
    await fundWallet(wallet);
    const recipientAddress = await recipient.getAddress();
    const txId = await submit(wallet, owner0, recipientAddress, ethers.parseEther("0.05"));

    await (await wallet.connect(owner0).confirmTransaction(txId)).wait();
    await (await wallet.connect(owner1).confirmTransaction(txId)).wait();
    assert.equal(await wallet.getConfirmationCount(txId), 2n);

    await (await wallet.connect(owner1).revokeConfirmation(txId)).wait();
    assert.equal(await wallet.getConfirmationCount(txId), 1n);

    await expectRevert(() => wallet.connect(owner2).executeTransaction(txId), null);

    await (await wallet.connect(owner2).confirmTransaction(txId)).wait();
    const before = await provider.getBalance(recipientAddress);
    const executeReceipt = await (await wallet.connect(owner0).executeTransaction(txId)).wait();
    const after = await provider.getBalance(recipientAddress, executeReceipt.blockNumber);

    assert.equal(executeReceipt.status, 1);
    assert.equal(after - before, ethers.parseEther("0.05"));
    assert.equal((await wallet.transactions(txId)).executed, true);
  });

  it("blocks callback-time confirmation revocation from an owner contract", async function () {
    const revoker = await deploy(contracts, owner0, "test/CallbackRevoker.sol", "CallbackRevoker");
    const wallet = await deployWallet({
      owners: [await owner0.getAddress(), await revoker.getAddress(), await owner2.getAddress()],
      required: 2,
    });
    await (await revoker.setWallet(await wallet.getAddress())).wait();

    const data = revoker.interface.encodeFunctionData("triggerRevoke", [0n]);
    const txId = await submit(wallet, owner0, await revoker.getAddress(), 0n, data);
    assert.equal(txId, 0n);

    await (await wallet.connect(owner0).confirmTransaction(txId)).wait();
    await (await revoker.confirm(txId)).wait();
    assert.equal(await wallet.getConfirmationCount(txId), 2n);

    const receipt = await (await wallet.connect(owner2).executeTransaction(txId)).wait();

    assert.equal(receipt.status, 1);
    assert.equal(await revoker.revokeAttempted(), true);
    assert.equal(await revoker.revokeBlocked(), true);
    assert.equal(await wallet.confirmations(txId, await revoker.getAddress()), true);
    assert.equal((await wallet.transactions(txId)).executed, true);
  });

  it("uses the previous block confirmation snapshot against same-block revocation front-running", async function () {
    const revoker = await deploy(contracts, owner0, "test/CallbackRevoker.sol", "CallbackRevoker");
    const wallet = await deployWallet({
      owners: [await owner0.getAddress(), await revoker.getAddress(), await owner2.getAddress()],
      required: 2,
    });
    await (await revoker.setWallet(await wallet.getAddress())).wait();
    await fundWallet(wallet);
    const recipientAddress = await recipient.getAddress();
    const txId = await submit(wallet, owner0, recipientAddress, ethers.parseEther("0.01"));

    await (await wallet.connect(owner0).confirmTransaction(txId)).wait();
    const confirmReceipt = await (await revoker.confirm(txId)).wait();
    const snapshotBlock = confirmReceipt.blockNumber;
    assert.equal(await wallet.isConfirmedAtBlock(txId, await revoker.getAddress(), snapshotBlock), true);

    const before = await provider.getBalance(recipientAddress);
    const receipt = await (await revoker.revokeThenExecute(txId)).wait();
    const after = await provider.getBalance(recipientAddress, receipt.blockNumber);

    assert.equal(receipt.status, 1);
    assert.equal(after - before, ethers.parseEther("0.01"));
    assert.equal(await wallet.confirmations(txId, await revoker.getAddress()), false);
    assert.equal((await wallet.transactions(txId)).executed, true);
  });

  it("keeps a simple ETH transfer execution under 100,000 gas", async function () {
    const wallet = await deployWallet({
      owners: [await owner0.getAddress(), await owner1.getAddress()],
      required: 2,
    });
    await fundWallet(wallet);
    const txId = await submit(
      wallet,
      owner0,
      await recipient.getAddress(),
      ethers.parseEther("0.01"),
    );

    await (await wallet.connect(owner0).confirmTransaction(txId)).wait();
    await (await wallet.connect(owner1).confirmTransaction(txId)).wait();
    const receipt = await (await wallet.connect(owner0).executeTransaction(txId)).wait();

    assert.ok(receipt.gasUsed <= 100_000n, `gas used ${receipt.gasUsed.toString()}`);
  });
});
