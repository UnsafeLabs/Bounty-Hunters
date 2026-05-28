import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ethers } from "ethers";
import ganache from "ganache";
import solc from "solc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const solidityRoot = path.resolve(__dirname, "..");

const mockFeedSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockFeed {
    uint8 public decimals;
    uint80 public roundId = 1;
    int256 public answer = 1;
    uint256 public startedAt = 1;
    uint256 public updatedAt = 1;
    uint80 public answeredInRound = 1;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function setRoundData(
        uint80 roundId_,
        int256 answer_,
        uint256 startedAt_,
        uint256 updatedAt_,
        uint80 answeredInRound_
    ) external {
        roundId = roundId_;
        answer = answer_;
        startedAt = startedAt_;
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
}
`;

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "solidity/contracts/PriceOracle.sol": {
        content: readFileSync(path.join(solidityRoot, "contracts", "PriceOracle.sol"), "utf8"),
      },
      "test/MockFeed.sol": {
        content: mockFeedSource,
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
  assert.deepEqual(errors, []);

  return {
    oracle: output.contracts["solidity/contracts/PriceOracle.sol"].PriceOracle,
    feed: output.contracts["test/MockFeed.sol"].MockFeed,
  };
}

async function deploy(contract, signer, args = []) {
  const factory = new ethers.ContractFactory(
    contract.abi,
    `0x${contract.evm.bytecode.object}`,
    signer,
  );
  const deployment = await factory.deploy(...args);
  await deployment.waitForDeployment();
  return deployment;
}

async function expectRevert(action, messagePattern = /revert/i) {
  try {
    await action();
  } catch (error) {
    assert.match(String(error.shortMessage ?? error.message), messagePattern);
    return;
  }
  assert.fail("Expected revert");
}

async function setFeed(feed, { roundId = 1n, answer = 2_000_00000000n, updatedAt, answeredInRound }) {
  const tx = await feed.setRoundData(
    roundId,
    answer,
    updatedAt,
    updatedAt,
    answeredInRound ?? roundId,
  );
  await tx.wait();
}

describe("PriceOracle", function () {
  let contracts;
  let provider;
  let owner;
  let other;
  let now;

  before(function () {
    contracts = compileContracts();
  });

  beforeEach(async function () {
    const ganacheProvider = ganache.provider({
      chain: { chainId: 31_337 },
      logging: { quiet: true },
      wallet: { deterministic: true, totalAccounts: 4 },
    });
    provider = new ethers.BrowserProvider(ganacheProvider);
    owner = await provider.getSigner(0);
    other = await provider.getSigner(1);
    now = BigInt((await provider.getBlock("latest")).timestamp);
  });

  async function deployOracle() {
    const primary = await deploy(contracts.feed, owner, [8]);
    const fallback = await deploy(contracts.feed, owner, [8]);
    const oracle = await deploy(contracts.oracle, owner, [await primary.getAddress()]);
    await (await oracle.setFallbackFeed(await fallback.getAddress())).wait();
    return { primary, fallback, oracle };
  }

  it("returns a valid fresh primary price", async function () {
    const { primary, oracle } = await deployOracle();
    await setFeed(primary, { answer: 2_500_00000000n, updatedAt: now - 60n });

    assert.equal(await oracle.getLatestPrice.staticCall(), 2_500_00000000n);
  });

  it("falls back and emits StalePrice when the primary price is stale", async function () {
    const { primary, fallback, oracle } = await deployOracle();
    await setFeed(primary, { answer: 1_000_00000000n, updatedAt: now - 7200n });
    await setFeed(fallback, { answer: 2_000_00000000n, updatedAt: now - 60n });

    assert.equal(await oracle.getLatestPrice.staticCall(), 2_000_00000000n);
    const receipt = await (await oracle.getLatestPrice()).wait();
    const staleEvents = receipt.logs
      .map((log) => {
        try {
          return oracle.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter((event) => event?.name === "StalePrice");

    assert.equal(staleEvents.length, 1);
    assert.equal(staleEvents[0].args.feed, await primary.getAddress());
    assert.equal(staleEvents[0].args.updatedAt, now - 7200n);
  });

  it("rejects zero or negative prices", async function () {
    const { primary, oracle } = await deployOracle();
    await setFeed(primary, { answer: 0n, updatedAt: now - 60n });

    await expectRevert(
      () => oracle.getLatestPrice.staticCall(),
      /Invalid price|revert/i,
    );

    await setFeed(primary, { answer: -1n, updatedAt: now - 60n });
    await expectRevert(
      () => oracle.getLatestPrice.staticCall(),
      /Invalid price|revert/i,
    );
  });

  it("rejects incomplete rounds", async function () {
    const { primary, oracle } = await deployOracle();
    await setFeed(primary, {
      roundId: 10n,
      answer: 2_000_00000000n,
      updatedAt: now - 60n,
      answeredInRound: 9n,
    });

    await expectRevert(
      () => oracle.getLatestPrice.staticCall(),
      /Incomplete round|revert/i,
    );
  });

  it("reverts when both primary and fallback prices are stale", async function () {
    const { primary, fallback, oracle } = await deployOracle();
    await setFeed(primary, { answer: 2_000_00000000n, updatedAt: now - 7200n });
    await setFeed(fallback, { answer: 2_100_00000000n, updatedAt: now - 7200n });

    await expectRevert(
      () => oracle.getLatestPrice.staticCall(),
      /Stale price|revert/i,
    );
  });

  it("lets only the owner configure max staleness and fallback feed", async function () {
    const { primary, fallback, oracle } = await deployOracle();
    const wrongDecimalsFeed = await deploy(contracts.feed, owner, [18]);

    await expectRevert(
      async () => {
        const tx = await oracle.connect(other).setMaxStaleness(7200);
        await tx.wait();
      },
      /Not owner|revert/i,
    );
    await expectRevert(
      async () => {
        const tx = await oracle.setFallbackFeed(await primary.getAddress());
        await tx.wait();
      },
      /Invalid fallback feed|revert/i,
    );
    await expectRevert(
      async () => {
        const tx = await oracle.setFallbackFeed(await wrongDecimalsFeed.getAddress());
        await tx.wait();
      },
      /Decimals mismatch|revert/i,
    );

    await (await oracle.setMaxStaleness(7200)).wait();
    assert.equal(await oracle.MAX_STALENESS(), 7200n);

    await setFeed(primary, { answer: 2_000_00000000n, updatedAt: now - 5400n });
    assert.equal(await oracle.getLatestPrice.staticCall(), 2_000_00000000n);

    await (await oracle.setFallbackFeed(await fallback.getAddress())).wait();
    assert.equal(await oracle.fallbackFeed(), await fallback.getAddress());
  });
});
