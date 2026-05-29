import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const externalModules = process.env.SOLIDITY_TEST_NODE_MODULES;
const require = createRequire(
  externalModules
    ? path.join(externalModules, "package.json")
    : import.meta.url
);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const solidityDir = path.resolve(testDir, "..");

const solc = require("solc");
const ganache = require("ganache");
const { ethers } = require("ethers");

const priceOracleSource = fs.readFileSync(
  path.join(solidityDir, "contracts", "PriceOracle.sol"),
  "utf8"
);

const mockSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockAggregator {
    uint8 public immutable decimals;
    uint80 private roundId;
    int256 private answer;
    uint256 private startedAt;
    uint256 private updatedAt;
    uint80 private answeredInRound;

    constructor(uint8 _decimals) {
        decimals = _decimals;
    }

    function setRoundData(
        uint80 _roundId,
        int256 _answer,
        uint256 _startedAt,
        uint256 _updatedAt,
        uint80 _answeredInRound
    ) external {
        roundId = _roundId;
        answer = _answer;
        startedAt = _startedAt;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
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
}
`;

function compile() {
  const input = {
    language: "Solidity",
    sources: {
      "PriceOracle.sol": { content: priceOracleSource },
      "MockAggregator.sol": { content: mockSource },
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
  const errors = (output.errors ?? []).filter(
    (error) => error.severity === "error"
  );
  assert.equal(errors.length, 0, errors.map((error) => error.formattedMessage).join("\n"));
  return output.contracts;
}

async function deploy(factory, signer, ...args) {
  const contract = await factory.connect(signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function expectRejects(promise, expectedMessage) {
  await assert.rejects(
    promise,
    (error) => String(error).includes(expectedMessage),
    `Expected revert containing ${expectedMessage}`
  );
}

async function run() {
  const contracts = compile();
  const provider = new ethers.BrowserProvider(
    ganache.provider({ logging: { quiet: true } })
  );
  const [owner, attacker] = await Promise.all([
    provider.getSigner(0),
    provider.getSigner(1),
  ]);

  const oracleArtifact = contracts["PriceOracle.sol"].PriceOracle;
  const mockArtifact = contracts["MockAggregator.sol"].MockAggregator;
  const Oracle = new ethers.ContractFactory(
    oracleArtifact.abi,
    oracleArtifact.evm.bytecode.object,
    owner
  );
  const Mock = new ethers.ContractFactory(
    mockArtifact.abi,
    mockArtifact.evm.bytecode.object,
    owner
  );

  async function fixture() {
    const primary = await deploy(Mock, owner, 8);
    const fallback = await deploy(Mock, owner, 8);
    const oracle = await deploy(Oracle, owner, await primary.getAddress());
    await (await oracle.setFallbackFeed(await fallback.getAddress())).wait();
    const now = BigInt((await provider.getBlock("latest")).timestamp);
    return { primary, fallback, oracle, now };
  }

  {
    const { primary, fallback, oracle, now } = await fixture();
    await primary.setRoundData(10, 2000_00000000n, now, now, 10);
    await fallback.setRoundData(11, 1900_00000000n, now, now, 11);
    const price = await oracle.getLatestPrice.staticCall();
    assert.equal(price, 2000_00000000n);
  }

  {
    const { primary, fallback, oracle, now } = await fixture();
    const staleTime = now - 7200n;
    await primary.setRoundData(20, 1800_00000000n, staleTime, staleTime, 20);
    await fallback.setRoundData(21, 1810_00000000n, now, now, 21);

    const fallbackPrice = await oracle.getLatestPrice.staticCall();
    assert.equal(fallbackPrice, 1810_00000000n);

    const tx = await oracle.getLatestPrice();
    const receipt = await tx.wait();
    const staleEvent = receipt.logs
      .map((log) => {
        try {
          return oracle.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((event) => event?.name === "StalePrice");

    assert.ok(staleEvent, "StalePrice event was not emitted");
    assert.equal(staleEvent.args.feed, await primary.getAddress());
    assert.equal(staleEvent.args.updatedAt, staleTime);
  }

  {
    const { primary, oracle, now } = await fixture();
    await primary.setRoundData(30, 0, now, now, 30);
    await expectRejects(oracle.getLatestPrice.staticCall(), "Invalid price");

    await primary.setRoundData(31, -1, now, now, 31);
    await expectRejects(oracle.getLatestPrice.staticCall(), "Invalid price");
  }

  {
    const { primary, oracle, now } = await fixture();
    await primary.setRoundData(40, 2000_00000000n, now, now, 39);
    await expectRejects(oracle.getLatestPrice.staticCall(), "Incomplete round");
  }

  {
    const { primary, fallback, oracle, now } = await fixture();
    const staleTime = now - 7200n;
    await primary.setRoundData(50, 2000_00000000n, staleTime, staleTime, 50);
    await fallback.setRoundData(51, 1995_00000000n, staleTime, staleTime, 51);
    await expectRejects(oracle.getLatestPrice.staticCall(), "Stale price");
  }

  {
    const { primary, oracle, now } = await fixture();
    await primary.setRoundData(60, 2000_00000000n, now - 120n, now - 120n, 60);
    await (await oracle.setMaxStaleness(300)).wait();
    assert.equal(await oracle.getLatestPrice.staticCall(), 2000_00000000n);
    await expectRejects(
      oracle.connect(attacker).setMaxStaleness.staticCall(300),
      "Not owner"
    );
    await expectRejects(
      oracle.setMaxStaleness.staticCall(0),
      "Invalid staleness"
    );
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
