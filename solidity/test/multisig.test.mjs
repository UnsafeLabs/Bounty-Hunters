import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ganache from "ganache";
import solc from "solc";
import { ethers } from "ethers";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(testDir, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(projectDir, relativePath), "utf8");
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/MultiSigWallet.sol": { content: readSource("contracts/MultiSigWallet.sol") },
      "test/MultiSigTestTargets.sol": { content: readSource("test/MultiSigTestTargets.sol") },
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
  const errors = output.errors?.filter((entry) => entry.severity === "error") ?? [];
  assert.equal(errors.length, 0, errors.map((entry) => entry.formattedMessage).join("\n"));
  return output.contracts;
}

function getArtifact(contracts, name) {
  for (const contractGroup of Object.values(contracts)) {
    if (contractGroup[name]) {
      return contractGroup[name];
    }
  }
  throw new Error(`Missing compiled artifact for ${name}`);
}

async function deploy(contracts, signer, name, args = []) {
  const artifact = getArtifact(contracts, name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function expectRevert(action, pattern) {
  try {
    await action();
  } catch (error) {
    assert.match(String(error), pattern);
    return;
  }
  assert.fail("Expected transaction to revert");
}

async function rawBalance(provider, address) {
  return BigInt(await provider.send("eth_getBalance", [address, "latest"]));
}

const contracts = compileContracts();

async function setup(required = 2n, ownerCount = 3) {
  const provider = new ethers.BrowserProvider(
    ganache.provider({
      logging: { quiet: true },
      wallet: { totalAccounts: 5, defaultBalance: 1000 },
    }),
  );
  const signers = await Promise.all([0, 1, 2, 3].map((index) => provider.getSigner(index)));
  const owners = await Promise.all(signers.slice(0, ownerCount).map((signer) => signer.getAddress()));
  const wallet = await deploy(contracts, signers[0], "MultiSigWallet", [owners, required]);
  await (await signers[0].sendTransaction({ to: await wallet.getAddress(), value: ethers.parseEther("1") })).wait();
  return { provider, signers, owners, wallet };
}

async function submit(wallet, signer, to, value = 0n, data = "0x") {
  const txId = await wallet.connect(signer).submitTransaction.staticCall(to, value, data);
  await (await wallet.connect(signer).submitTransaction(to, value, data)).wait();
  return txId;
}

{
  const { provider, signers, wallet } = await setup(2n, 2);
  const recipient = await signers[3].getAddress();
  const recipientBefore = await rawBalance(provider, recipient);
  const txId = await submit(wallet, signers[0], recipient, ethers.parseEther("0.01"));
  assert.equal((await wallet.transactions(txId)).value, ethers.parseEther("0.01"));

  await (await wallet.connect(signers[0]).confirmTransaction(txId)).wait();
  await (await wallet.connect(signers[1]).confirmTransaction(txId)).wait();
  await (await wallet.connect(signers[1]).revokeConfirmation(txId)).wait();
  assert.equal(await wallet.getConfirmationCount(txId), 1n);
  await (await wallet.connect(signers[1]).confirmTransaction(txId)).wait();

  const receipt = await (await wallet.connect(signers[0]).executeTransaction(txId)).wait();
  assert(receipt.gasUsed < 100_000n, `simple transfer used ${receipt.gasUsed} gas`);
  assert.equal(await rawBalance(provider, recipient), recipientBefore + ethers.parseEther("0.01"));
}

{
  const { signers, wallet } = await setup();
  const eoaTarget = await signers[3].getAddress();

  await expectRevert(
    () => wallet.connect(signers[0]).submitTransaction.staticCall(ethers.ZeroAddress, 0n, "0x"),
    /Invalid target/,
  );

  await expectRevert(
    () => wallet.connect(signers[0]).submitTransaction.staticCall(eoaTarget, 0n, "0x1234"),
    /Target must be contract/,
  );
}

{
  const { signers, wallet } = await setup();
  const recipient = await signers[3].getAddress();
  const txId = await submit(wallet, signers[0], recipient, 0n);

  const confirmReceipt = await (await wallet.connect(signers[0]).confirmTransaction(txId)).wait();
  await (await wallet.connect(signers[1]).confirmTransaction(txId)).wait();
  const revokeReceipt = await (await wallet.connect(signers[1]).revokeConfirmation(txId)).wait();

  assert.equal(await wallet.isConfirmedAtBlock(txId, await signers[0].getAddress(), confirmReceipt.blockNumber), true);
  assert.equal(await wallet.isConfirmedAtBlock(txId, await signers[1].getAddress(), revokeReceipt.blockNumber), false);
  await expectRevert(
    () => wallet.connect(signers[0]).executeTransaction.staticCall(txId),
    /Not enough confirmations/,
  );
}

{
  const provider = new ethers.BrowserProvider(
    ganache.provider({
      logging: { quiet: true },
      wallet: { totalAccounts: 4, defaultBalance: 1000 },
    }),
  );
  const [owner, funder] = await Promise.all([0, 1].map((index) => provider.getSigner(index)));
  const callbackOwner = await deploy(contracts, owner, "RevocationCallbackOwner");
  const wallet = await deploy(contracts, owner, "MultiSigWallet", [
    [await owner.getAddress(), await callbackOwner.getAddress()],
    2n,
  ]);
  await (await callbackOwner.setWallet(await wallet.getAddress())).wait();
  await (await funder.sendTransaction({ to: await wallet.getAddress(), value: ethers.parseEther("1") })).wait();

  const data = callbackOwner.interface.encodeFunctionData("tryRevoke", [0n]);
  const txId = await submit(wallet, owner, await callbackOwner.getAddress(), 0n, data);
  assert.equal(txId, 0n);
  await (await wallet.connect(owner).confirmTransaction(txId)).wait();
  await (await callbackOwner.confirm(txId)).wait();

  await expectRevert(
    () => wallet.connect(owner).executeTransaction.staticCall(txId),
    /Execution failed|Execution in progress/,
  );
  assert.equal((await wallet.transactions(txId)).executed, false);
}

console.log("MultiSigWallet confirmation snapshot regressions passed");
