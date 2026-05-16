const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const contractPath = path.join(__dirname, "..", "contracts", "PriceOracle.sol");
const source = fs.readFileSync(contractPath, "utf8");

let server;
let provider;
let accounts;
let compiled;

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/PriceOracle.sol": { content: source },
      "test/MockAggregator.sol": {
        content: `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/PriceOracle.sol";

contract MockAggregator is AggregatorV3Interface {
    uint80 private roundId;
    int256 private answer;
    uint256 private startedAt;
    uint256 private updatedAt;
    uint80 private answeredInRound;
    uint8 private feedDecimals;

    constructor(uint8 decimals_) {
        feedDecimals = decimals_;
    }

    function setRoundData(
        uint80 roundId_,
        int256 answer_,
        uint256 updatedAt_,
        uint80 answeredInRound_
    ) external {
        roundId = roundId_;
        answer = answer_;
        startedAt = updatedAt_;
        updatedAt = updatedAt_;
        answeredInRound = answeredInRound_;
    }

    function latestRoundData() external view returns (
        uint80,
        int256,
        uint256,
        uint256,
        uint80
    ) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function decimals() external view returns (uint8) {
        return feedDecimals;
    }
}
`,
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

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (importPath) => {
        if (importPath === "../contracts/PriceOracle.sol") {
          return { contents: source };
        }
        return { error: `Unable to resolve import: ${importPath}` };
      },
    }),
  );

  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.deepEqual(errors, []);
  return output.contracts;
}

async function deploy(name, signer, args = []) {
  const artifact =
    compiled["contracts/PriceOracle.sol"]?.[name] ?? compiled["test/MockAggregator.sol"][name];
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.evm.bytecode.object,
    signer,
  );
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function now() {
  const block = await provider.getBlock("latest");
  return BigInt(block.timestamp);
}

async function deployOracle() {
  const [owner, other] = accounts;
  const primary = await deploy("MockAggregator", owner, [8]);
  const fallback = await deploy("MockAggregator", owner, [8]);
  const oracle = await deploy("PriceOracle", owner, [await primary.getAddress()]);
  await oracle.setFallbackFeed(await fallback.getAddress());
  return { owner, other, primary, fallback, oracle };
}

async function setRound(feed, roundId, answer, updatedAt, answeredInRound = roundId) {
  await feed.setRoundData(roundId, answer, updatedAt, answeredInRound);
}

before(async () => {
  compiled = compileContracts();
  server = ganache.server({ logging: { quiet: true } });
  await server.listen(0);
  provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${server.address().port}`);
  accounts = await provider.listAccounts();
});

after(async () => {
  await provider?.destroy();
  await server?.close();
});

test("returns a valid primary price", async () => {
  const { primary, oracle } = await deployOracle();
  const timestamp = await now();
  await setRound(primary, 7, 2000n * 10n ** 8n, timestamp);

  assert.equal(await oracle.getLatestPrice.staticCall(), 2000n * 10n ** 8n);
});

test("falls back and emits StalePrice when the primary price is stale", async () => {
  const { primary, fallback, oracle } = await deployOracle();
  const timestamp = await now();
  await setRound(primary, 7, 2000n * 10n ** 8n, timestamp - 7200n);
  await setRound(fallback, 8, 1995n * 10n ** 8n, timestamp);

  assert.equal(await oracle.getLatestPrice.staticCall(), 1995n * 10n ** 8n);
  const receipt = await (await oracle.getLatestPrice()).wait();
  const logs = receipt.logs.map((log) => oracle.interface.parseLog(log));
  const staleLog = logs.find((log) => log?.name === "StalePrice");

  assert.equal(staleLog.args.feed, await primary.getAddress());
  assert.equal(staleLog.args.updatedAt, timestamp - 7200n);
});

test("rejects zero and negative prices", async () => {
  const { primary, oracle } = await deployOracle();
  const timestamp = await now();

  await setRound(primary, 7, 0, timestamp);
  await assert.rejects(oracle.getLatestPrice.staticCall(), /Invalid price/);

  await setRound(primary, 8, -1, timestamp);
  await assert.rejects(oracle.getLatestPrice.staticCall(), /Invalid price/);
});

test("rejects incomplete rounds", async () => {
  const { primary, oracle } = await deployOracle();
  const timestamp = await now();
  await setRound(primary, 9, 2000n * 10n ** 8n, timestamp, 8);

  await assert.rejects(oracle.getLatestPrice.staticCall(), /Incomplete round/);
});

test("reverts when both primary and fallback prices are stale", async () => {
  const { primary, fallback, oracle } = await deployOracle();
  const timestamp = await now();
  await setRound(primary, 7, 2000n * 10n ** 8n, timestamp - 7200n);
  await setRound(fallback, 8, 1995n * 10n ** 8n, timestamp - 7200n);

  await assert.rejects(oracle.getLatestPrice.staticCall(), /Stale price/);
});

test("allows only the owner to configure staleness and fallback feed", async () => {
  const { other, oracle } = await deployOracle();
  const replacement = await deploy("MockAggregator", other, [8]);

  await oracle.setMaxStaleness(120);
  assert.equal(await oracle.MAX_STALENESS(), 120n);

  await assert.rejects(oracle.connect(other).setMaxStaleness(60));
  await assert.rejects(
    oracle.connect(other).setFallbackFeed(await replacement.getAddress()),
  );
});
