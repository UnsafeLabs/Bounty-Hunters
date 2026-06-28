const { expect } = require("chai");
const { ethers } = require("ethers");
const ganache = require("ganache");
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const rootDir = path.join(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/PriceOracle.sol": {
        content: readSource("contracts/PriceOracle.sol"),
      },
      "contracts/test/MockPriceFeed.sol": {
        content: readSource("contracts/test/MockPriceFeed.sol"),
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

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
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

async function expectRevert(promiseFactory, expectedMessage) {
  try {
    await promiseFactory();
  } catch (error) {
    const text = [
      error.message,
      error.shortMessage,
      error.reason,
      error.info && error.info.error && error.info.error.message,
    ]
      .filter(Boolean)
      .join("\n");
    expect(text).to.include(expectedMessage);
    return;
  }
  throw new Error("Expected transaction to revert");
}

async function latestTimestamp(provider) {
  return BigInt((await provider.getBlock("latest")).timestamp);
}

async function setRound(feed, { roundId = 1n, answer, updatedAt, answeredInRound = roundId }) {
  await (
    await feed.setRoundData(roundId, answer, updatedAt, updatedAt, answeredInRound)
  ).wait();
}

function parsedEvents(contract, receipt) {
  return receipt.logs
    .map((log) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

describe("PriceOracle staleness and fallback validation", function () {
  let contracts;
  let feedArtifact;
  let oracleArtifact;
  let provider;
  let owner;
  let user;

  before(function () {
    contracts = compileContracts();
    feedArtifact = getArtifact(contracts, "contracts/test/MockPriceFeed.sol", "MockPriceFeed");
    oracleArtifact = getArtifact(contracts, "contracts/PriceOracle.sol", "PriceOracle");
  });

  beforeEach(async function () {
    provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true } }));
    owner = await provider.getSigner(0);
    user = await provider.getSigner(1);
  });

  async function deployOracle() {
    const primary = await deploy(owner, feedArtifact, [8]);
    const fallback = await deploy(owner, feedArtifact, [8]);
    const oracle = await deploy(owner, oracleArtifact, [await primary.getAddress()]);
    await (await oracle.setFallbackFeed(await fallback.getAddress())).wait();
    return { primary, fallback, oracle };
  }

  it("returns a valid primary price", async function () {
    const { primary, oracle } = await deployOracle();
    const now = await latestTimestamp(provider);
    await setRound(primary, { answer: 200000000000n, updatedAt: now });

    expect(await oracle.getLatestPrice.staticCall()).to.equal(200000000000n);

    const receipt = await (await oracle.getLatestPrice()).wait();
    const events = parsedEvents(oracle, receipt);
    const queried = events.find((event) => event.name === "PriceQueried");
    expect(queried.args.feed).to.equal(await primary.getAddress());
    expect(queried.args.price).to.equal(200000000000n);
  });

  it("falls back on a stale primary price and emits StalePrice", async function () {
    const { primary, fallback, oracle } = await deployOracle();
    const now = await latestTimestamp(provider);
    const staleUpdatedAt = now - 7200n;
    await setRound(primary, { answer: 100000000000n, updatedAt: staleUpdatedAt });
    await setRound(fallback, { answer: 99000000000n, updatedAt: now });

    expect(await oracle.getLatestPrice.staticCall()).to.equal(99000000000n);

    const receipt = await (await oracle.getLatestPrice()).wait();
    const events = parsedEvents(oracle, receipt);
    const stale = events.find((event) => event.name === "StalePrice");
    const queried = events.find((event) => event.name === "PriceQueried");

    expect(stale.args.feed).to.equal(await primary.getAddress());
    expect(stale.args.updatedAt).to.equal(staleUpdatedAt);
    expect(queried.args.feed).to.equal(await fallback.getAddress());
  });

  it("rejects zero and negative prices", async function () {
    const { primary, oracle } = await deployOracle();
    const now = await latestTimestamp(provider);

    await setRound(primary, { answer: 0n, updatedAt: now });
    await expectRevert(async () => {
      await oracle.getLatestPrice.staticCall();
    }, "Invalid price");

    await setRound(primary, { answer: -1n, updatedAt: now });
    await expectRevert(async () => {
      await oracle.getLatestPrice.staticCall();
    }, "Invalid price");
  });

  it("rejects incomplete rounds", async function () {
    const { primary, oracle } = await deployOracle();
    const now = await latestTimestamp(provider);
    await setRound(primary, {
      roundId: 10n,
      answer: 100000000000n,
      updatedAt: now,
      answeredInRound: 9n,
    });

    await expectRevert(async () => {
      await oracle.getLatestPrice.staticCall();
    }, "Incomplete round");
  });

  it("reverts instead of returning stale data when both oracles are stale", async function () {
    const { primary, fallback, oracle } = await deployOracle();
    const now = await latestTimestamp(provider);
    await setRound(primary, { answer: 100000000000n, updatedAt: now - 7200n });
    await setRound(fallback, { answer: 99000000000n, updatedAt: now - 7200n });

    await expectRevert(async () => {
      await oracle.getLatestPrice.staticCall();
    }, "Stale price");
  });

  it("lets only the owner configure max staleness", async function () {
    const { primary, fallback, oracle } = await deployOracle();
    const now = await latestTimestamp(provider);
    await setRound(primary, { answer: 100000000000n, updatedAt: now - 120n });
    await setRound(fallback, { answer: 99000000000n, updatedAt: now });

    expect(await oracle.getLatestPrice.staticCall()).to.equal(100000000000n);

    await expectRevert(async () => {
      await (await oracle.connect(user).setMaxStaleness(60n)).wait();
    }, "Not owner");

    await (await oracle.setMaxStaleness(60n)).wait();
    expect(await oracle.MAX_STALENESS()).to.equal(60n);
    expect(await oracle.getLatestPrice.staticCall()).to.equal(99000000000n);
  });
});
