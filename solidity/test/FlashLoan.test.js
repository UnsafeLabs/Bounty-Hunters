const { expect } = require("chai");
const { ethers } = require("ethers");
const ganache = require("ganache");
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const rootDir = path.join(__dirname, "..");
const parseUnits = ethers.parseUnits;

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
      "contracts/FlashLoan.sol": {
        content: readSource("contracts/FlashLoan.sol"),
      },
      "contracts/test/FlashLoanReceiver.sol": {
        content: readSource("contracts/test/FlashLoanReceiver.sol"),
      },
      "contracts/test/MockFlashLoanToken.sol": {
        content: readSource("contracts/test/MockFlashLoanToken.sol"),
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

describe("FlashLoan pool protection", function () {
  let contracts;
  let tokenArtifact;
  let rebasingTokenArtifact;
  let flashLoanArtifact;
  let receiverArtifact;
  let provider;
  let owner;
  let user;

  before(function () {
    contracts = compileContracts();
    tokenArtifact = getArtifact(
      contracts,
      "contracts/test/MockFlashLoanToken.sol",
      "MockFlashLoanToken",
    );
    rebasingTokenArtifact = getArtifact(
      contracts,
      "contracts/test/MockFlashLoanToken.sol",
      "RebasingFlashLoanToken",
    );
    flashLoanArtifact = getArtifact(contracts, "contracts/FlashLoan.sol", "FlashLoan");
    receiverArtifact = getArtifact(
      contracts,
      "contracts/test/FlashLoanReceiver.sol",
      "FlashLoanReceiver",
    );
  });

  beforeEach(async function () {
    provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true } }));
    owner = await provider.getSigner(0);
    user = await provider.getSigner(1);
  });

  async function deployPool(TokenArtifact = tokenArtifact, feeBPS = 100n) {
    const token = await deploy(owner, TokenArtifact);
    const lender = await deploy(owner, flashLoanArtifact, [await token.getAddress(), feeBPS]);
    const receiver = await deploy(user, receiverArtifact, [await lender.getAddress()]);

    await (await token.mint(await owner.getAddress(), parseUnits("1000", 18))).wait();
    await (await token.mint(await receiver.getAddress(), parseUnits("10", 18))).wait();
    await (await token.approve(await lender.getAddress(), parseUnits("1000", 18))).wait();
    await (await lender.depositToPool(parseUnits("1000", 18))).wait();

    return { token, lender, receiver };
  }

  it("charges a minimum fee of one token unit and tracks fee accrual", async function () {
    const { token, lender, receiver } = await deployPool();

    expect(await lender.calculateFee(1n)).to.equal(1n);

    await (await receiver.connect(user).request(1n, "0x")).wait();

    expect(await receiver.lastFee()).to.equal(1n);
    expect(await lender.totalFees()).to.equal(1n);
    expect(await lender.getPoolBalance()).to.equal(parseUnits("1000", 18) + 1n);

    const ownerBefore = await token.balanceOf(await owner.getAddress());
    await (await lender.withdrawFees()).wait();

    expect(await lender.totalFees()).to.equal(0n);
    expect(await lender.getPoolBalance()).to.equal(parseUnits("1000", 18));
    expect(await token.balanceOf(await owner.getAddress())).to.equal(ownerBefore + 1n);
  });

  it("rejects loans above fifty percent of the accounted pool balance", async function () {
    const { lender, receiver } = await deployPool();

    expect(await lender.maxLoanAmount()).to.equal(parseUnits("500", 18));

    await expectRevert(async () => {
      await (await receiver.connect(user).request(parseUnits("501", 18), "0x")).wait();
    });
  });

  it("pauses and unpauses flash loans", async function () {
    const { lender, receiver } = await deployPool();

    await (await lender.pause()).wait();
    expect(await lender.paused()).to.equal(true);

    await expectRevert(async () => {
      await receiver.connect(user).request.staticCall(1n, "0x");
    });

    await (await lender.unpause()).wait();
    expect(await lender.paused()).to.equal(false);

    await (await receiver.connect(user).request(1n, "0x", { gasLimit: 500000 })).wait();
    expect(await receiver.lastFee()).to.equal(1n);
  });

  it("reverts when a rebasing token changes supply during the callback", async function () {
    const { lender, receiver } = await deployPool(rebasingTokenArtifact);

    await (await receiver.setRebaseDuringCallback(true)).wait();

    await expectRevert(async () => {
      await (await receiver.connect(user).request(1n, "0x")).wait();
    });

    expect(await lender.totalFees()).to.equal(0n);
    expect(await lender.getPoolBalance()).to.equal(parseUnits("1000", 18));
  });
});
