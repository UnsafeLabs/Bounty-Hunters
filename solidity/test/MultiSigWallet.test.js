const { expect } = require("chai");
const { ethers } = require("ethers");
const ganache = require("ganache");
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const rootDir = path.join(__dirname, "..");
const parseEther = ethers.parseEther;

function readSource(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function findImport(importPath) {
  const candidates = [
    path.join(rootDir, importPath),
    path.join(rootDir, "node_modules", importPath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }

  return { error: `File not found: ${importPath}` };
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/MultiSigWallet.sol": {
        content: readSource("contracts/MultiSigWallet.sol"),
      },
      "contracts/test/RevokingMultiSigOwner.sol": {
        content: readSource("contracts/test/RevokingMultiSigOwner.sol"),
      },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
  const errors = (output.errors || []).filter((error) => error.severity === "error");
  expect(errors.map((error) => error.formattedMessage)).to.deep.equal([]);
  return output.contracts;
}

function getArtifact(contracts, sourcePath, contractName) {
  const artifact = contracts[sourcePath][contractName];
  return {
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
  };
}

async function deploy(signer, artifact, args = []) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function expectRevert(promiseFactory) {
  try {
    await promiseFactory();
  } catch (error) {
    expect(error).to.exist;
    return;
  }
  throw new Error("Expected transaction to revert");
}

async function submit(wallet, signer, to, value = 0n, data = "0x") {
  const txId = await wallet.connect(signer).submitTransaction.staticCall(to, value, data);
  await (await wallet.connect(signer).submitTransaction(to, value, data)).wait();
  return txId;
}

async function executed(wallet, txId) {
  return wallet.isExecuted(txId);
}

describe("MultiSigWallet confirmation race protection", function () {
  let contracts;
  let walletArtifact;
  let revokerArtifact;
  let provider;
  let ownerA;
  let ownerB;
  let ownerC;
  let recipient;

  before(function () {
    contracts = compileContracts();
    walletArtifact = getArtifact(contracts, "contracts/MultiSigWallet.sol", "MultiSigWallet");
    revokerArtifact = getArtifact(
      contracts,
      "contracts/test/RevokingMultiSigOwner.sol",
      "RevokingMultiSigOwner",
    );
  });

  beforeEach(async function () {
    provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true } }));
    ownerA = await provider.getSigner(0);
    ownerB = await provider.getSigner(1);
    ownerC = await provider.getSigner(2);
    recipient = await provider.getSigner(3);
  });

  async function deployWallet(owners, required = 2) {
    const wallet = await deploy(ownerA, walletArtifact, [owners, required]);
    await (
      await ownerA.sendTransaction({
        to: await wallet.getAddress(),
        value: parseEther("10"),
      })
    ).wait();
    return wallet;
  }

  it("keeps submit, confirm, execute, and revoke flows working", async function () {
    const wallet = await deployWallet([
      await ownerA.getAddress(),
      await ownerB.getAddress(),
      await ownerC.getAddress(),
    ]);
    const txId = await submit(wallet, ownerA, await recipient.getAddress(), parseEther("1"));

    await (await wallet.connect(ownerA).confirmTransaction(txId)).wait();
    const ownerBAddress = await ownerB.getAddress();
    const confirmReceipt = await (await wallet.connect(ownerB).confirmTransaction(txId)).wait();
    const revokeReceipt = await (await wallet.connect(ownerB).revokeConfirmation(txId)).wait();
    expect(await wallet.getConfirmationCount(txId)).to.equal(1n);

    const reconfirmReceipt = await (await wallet.connect(ownerB).confirmTransaction(txId)).wait();
    expect(await wallet.isConfirmedAtBlock(txId, ownerBAddress, confirmReceipt.blockNumber)).to.equal(
      true,
    );
    expect(await wallet.isConfirmedAtBlock(txId, ownerBAddress, revokeReceipt.blockNumber)).to.equal(
      false,
    );
    expect(
      await wallet.isConfirmedAtBlock(txId, ownerBAddress, reconfirmReceipt.blockNumber),
    ).to.equal(true);
    expect(await wallet.getConfirmationCount(txId)).to.equal(2n);

    const walletAddress = await wallet.getAddress();
    const walletBefore = await provider.getBalance(walletAddress);
    const receipt = await (await wallet.connect(ownerA).executeTransaction(txId)).wait();

    expect(await executed(wallet, txId)).to.equal(true);
    expect(walletBefore - (await provider.getBalance(walletAddress, receipt.blockNumber))).to.equal(
      parseEther("1"),
    );
    expect(receipt.gasUsed < 100000n).to.equal(true);
  });

  it("prevents execution after a front-running revocation", async function () {
    const wallet = await deployWallet([
      await ownerA.getAddress(),
      await ownerB.getAddress(),
      await ownerC.getAddress(),
    ]);
    const ownerBAddress = await ownerB.getAddress();
    const txId = await submit(wallet, ownerA, await recipient.getAddress(), parseEther("1"));

    await (await wallet.connect(ownerA).confirmTransaction(txId)).wait();
    const confirmReceipt = await (await wallet.connect(ownerB).confirmTransaction(txId)).wait();
    const revokeReceipt = await (await wallet.connect(ownerB).revokeConfirmation(txId)).wait();

    expect(await wallet.isConfirmedAtBlock(txId, ownerBAddress, confirmReceipt.blockNumber)).to.equal(
      true,
    );
    expect(await wallet.isConfirmedAtBlock(txId, ownerBAddress, revokeReceipt.blockNumber)).to.equal(
      false,
    );
    expect(await wallet.getConfirmationCountAtBlock(txId, confirmReceipt.blockNumber)).to.equal(
      2n,
    );
    expect(await wallet.getConfirmationCount(txId)).to.equal(1n);

    await expectRevert(async () => {
      await (await wallet.connect(ownerA).executeTransaction(txId)).wait();
    });
  });

  it("rejects zero-address transaction targets and EOA calldata targets", async function () {
    const wallet = await deployWallet([
      await ownerA.getAddress(),
      await ownerB.getAddress(),
      await ownerC.getAddress(),
    ]);

    await expectRevert(async () => {
      await (await wallet.connect(ownerA).submitTransaction(ethers.ZeroAddress, 0, "0x")).wait();
    });
    await expectRevert(async () => {
      await (
        await wallet
          .connect(ownerA)
          .submitTransaction(await recipient.getAddress(), 0, "0x1234")
      ).wait();
    });
  });

  it("reverts execution if a confirmation is revoked during the callback", async function () {
    const revoker = await deploy(ownerA, revokerArtifact);
    const wallet = await deployWallet([
      await ownerA.getAddress(),
      await ownerB.getAddress(),
      await revoker.getAddress(),
    ]);
    await (await revoker.setWallet(await wallet.getAddress())).wait();

    const data = revoker.interface.encodeFunctionData("callback");
    const txId = await submit(wallet, ownerA, await revoker.getAddress(), 0n, data);

    await (await wallet.connect(ownerA).confirmTransaction(txId)).wait();
    await (await revoker.confirm(txId)).wait();
    await (await revoker.setRevokeDuringCallback(txId, true)).wait();

    await expectRevert(async () => {
      await (await wallet.connect(ownerA).executeTransaction(txId)).wait();
    });

    expect(await executed(wallet, txId)).to.equal(false);
    expect(await wallet.getConfirmationCount(txId)).to.equal(2n);
  });
});
