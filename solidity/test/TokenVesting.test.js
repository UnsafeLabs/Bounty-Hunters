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
      "contracts/TokenVesting.sol": {
        content: readSource("contracts/TokenVesting.sol"),
      },
      "contracts/test/MockVestingToken.sol": {
        content: readSource("contracts/test/MockVestingToken.sol"),
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

async function latestTimestamp(provider) {
  return BigInt((await provider.getBlock("latest")).timestamp);
}

async function mineAt(provider, timestamp) {
  const current = await latestTimestamp(provider);
  if (timestamp > current) {
    await provider.send("evm_increaseTime", [Number(timestamp - current)]);
  }
  await provider.send("evm_mine", []);
}

describe("TokenVesting overflow-safe accounting", function () {
  let contracts;
  let tokenArtifact;
  let vestingArtifact;
  let provider;
  let owner;
  let beneficiary;

  before(function () {
    contracts = compileContracts();
    tokenArtifact = getArtifact(
      contracts,
      "contracts/test/MockVestingToken.sol",
      "MockVestingToken",
    );
    vestingArtifact = getArtifact(contracts, "contracts/TokenVesting.sol", "TokenVesting");
  });

  beforeEach(async function () {
    provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true } }));
    owner = await provider.getSigner(0);
    beneficiary = await provider.getSigner(1);
  });

  async function deployVesting({
    allocation = 1000n,
    start,
    cliffDuration = 0n,
    duration = 100n,
  } = {}) {
    const token = await deploy(owner, tokenArtifact);
    const startTime = start ?? ((await latestTimestamp(provider)) + 100n);
    const vesting = await deploy(owner, vestingArtifact, [
      await token.getAddress(),
      await beneficiary.getAddress(),
      allocation,
      startTime,
      cliffDuration,
      duration,
    ]);
    await (await token.mint(await vesting.getAddress(), allocation)).wait();
    return { token, vesting, start: startTime, allocation, duration };
  }

  it("does not overflow for large allocations and very long vesting periods", async function () {
    const allocation = parseUnits("1000000000", 18);
    const overflowElapsed = ethers.MaxUint256 / allocation + 1n;
    const duration = overflowElapsed * 2n + 1n;
    const { vesting } = await deployVesting({
      allocation,
      start: 0n,
      duration,
    });

    const vested = await vesting.vestedAmountAt(overflowElapsed);
    const expected = (allocation * overflowElapsed) / duration;

    expect(vested).to.equal(expected);
    expect(vested > 0n).to.equal(true);
  });

  it("keeps the linear vesting curve accurate within one token unit", async function () {
    const allocation = parseUnits("1000000000", 18);
    const duration = 365n * 24n * 60n * 60n;
    const { vesting, start } = await deployVesting({ allocation, duration });

    for (const elapsed of [1n, 17n, 12345n, duration / 3n, duration / 2n, duration - 1n]) {
      const actual = await vesting.vestedAmountAt(start + elapsed);
      const expected = (allocation * elapsed) / duration;
      const delta = actual > expected ? actual - expected : expected - actual;
      expect(delta <= 1n).to.equal(true);
    }
  });

  it("handles remainders so the full allocation is claimable at vesting end", async function () {
    const allocation = 101n;
    const duration = 10n;
    const { token, vesting, start } = await deployVesting({ allocation, duration });

    expect(await vesting.vestedAmountAt(start + 1n)).to.equal(10n);
    expect(await vesting.vestedAmountAt(start + 5n)).to.equal(50n);
    expect(await vesting.vestedAmountAt(start + duration)).to.equal(allocation);

    await mineAt(provider, start + duration);
    await (await vesting.connect(beneficiary).claim()).wait();

    expect(await vesting.claimed()).to.equal(allocation);
    expect(await token.balanceOf(await beneficiary.getAddress())).to.equal(allocation);
    expect(await token.balanceOf(await vesting.getAddress())).to.equal(0n);
  });

  it("returns the full outstanding allocation to the owner when revoked during the cliff", async function () {
    const allocation = 1000n;
    const { token, vesting, start } = await deployVesting({
      allocation,
      cliffDuration: 100n,
      duration: 1000n,
    });

    await mineAt(provider, start + 50n);
    await (await vesting.revoke()).wait();

    expect(await token.balanceOf(await owner.getAddress())).to.equal(allocation);
    expect(await token.balanceOf(await beneficiary.getAddress())).to.equal(0n);
    expect(await token.balanceOf(await vesting.getAddress())).to.equal(0n);
    expect(await vesting.claimed()).to.equal(0n);
  });

  it("returns only truly unvested tokens after partial vesting", async function () {
    const allocation = 1000n;
    const { token, vesting, start } = await deployVesting({
      allocation,
      duration: 100n,
    });

    await mineAt(provider, start + 10n);
    await (await vesting.connect(beneficiary).claim()).wait();
    expect(await vesting.claimed()).to.equal(100n);

    await mineAt(provider, start + 40n);
    await (await vesting.revoke()).wait();

    expect(await token.balanceOf(await beneficiary.getAddress())).to.equal(400n);
    expect(await token.balanceOf(await owner.getAddress())).to.equal(600n);
    expect(await token.balanceOf(await vesting.getAddress())).to.equal(0n);
    expect(await vesting.claimed()).to.equal(400n);
  });
});
