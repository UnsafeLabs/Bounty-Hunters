import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ethers } from "ethers";
import ganache from "ganache";
import solc from "solc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const solidityRoot = path.resolve(__dirname, "..");

const mockAggregatorSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockAggregator {
    uint80 public roundId = 1;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound = 1;
    uint8 public decimals = 8;

    constructor(int256 initialAnswer, uint256 initialUpdatedAt) {
        answer = initialAnswer;
        startedAt = initialUpdatedAt;
        updatedAt = initialUpdatedAt;
    }

    function setRound(
        uint80 nextRoundId,
        int256 nextAnswer,
        uint256 nextUpdatedAt,
        uint80 nextAnsweredInRound
    ) external {
        roundId = nextRoundId;
        answer = nextAnswer;
        startedAt = nextUpdatedAt;
        updatedAt = nextUpdatedAt;
        answeredInRound = nextAnsweredInRound;
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
      "test/MockAggregator.sol": {
        content: mockAggregatorSource,
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
    aggregator: output.contracts["test/MockAggregator.sol"].MockAggregator,
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

async function expectRevert(action) {
  try {
    await action();
  } catch (error) {
    assert.match(String(error.shortMessage ?? error.message), /revert/i);
    return;
  }
  assert.fail("Expected revert");
}

const contracts = compileContracts();
const ganacheProvider = ganache.provider({
  chain: { chainId: 31_337 },
  logging: { quiet: true },
  wallet: { deterministic: true },
});
const provider = new ethers.BrowserProvider(ganacheProvider);
const owner = await provider.getSigner(0);
const other = await provider.getSigner(1);
const now = BigInt((await provider.getBlock("latest")).timestamp);

const primary = await deploy(contracts.aggregator, owner, [200_00000000n, now]);
const fallback = await deploy(contracts.aggregator, owner, [199_00000000n, now]);
const oracle = await deploy(contracts.oracle, owner, [
  await primary.getAddress(),
  await fallback.getAddress(),
]);

assert.equal(await oracle.getLatestPrice.staticCall(), 200_00000000n);
assert.equal(await oracle.getDecimals(), 8n);

await (await primary.setRound(2, 200_00000000n, now - 3_700n, 2)).wait();
assert.equal(await oracle.getLatestPrice.staticCall(), 199_00000000n);
const staleReceipt = await (await oracle.getLatestPrice()).wait();
const staleTopic = oracle.interface.getEvent("StalePrice").topicHash;
assert.equal(staleReceipt.logs.some((log) => log.topics[0] === staleTopic), true);

await (await fallback.setRound(2, 199_00000000n, now - 3_700n, 2)).wait();
await expectRevert(async () => {
  const tx = await oracle.getLatestPrice();
  await tx.wait();
});

await (await primary.setRound(3, -1n, now, 3)).wait();
await expectRevert(async () => {
  const tx = await oracle.getLatestPrice();
  await tx.wait();
});

await (await primary.setRound(4, 200_00000000n, now, 3)).wait();
await expectRevert(async () => {
  const tx = await oracle.getLatestPrice();
  await tx.wait();
});

await expectRevert(async () => {
  const tx = await oracle.connect(other).setMaxStaleness(7200);
  await tx.wait();
});
await (await oracle.setMaxStaleness(7200)).wait();
assert.equal(await oracle.MAX_STALENESS(), 7200n);

const replacementFallback = await deploy(contracts.aggregator, owner, [198_00000000n, now]);
await (await oracle.setFallbackFeed(await replacementFallback.getAddress())).wait();
assert.equal(await oracle.fallbackFeed(), await replacementFallback.getAddress());

console.log("PriceOracle validation and fallback tests passed");
