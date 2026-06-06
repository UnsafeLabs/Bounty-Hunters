import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import ganache from "ganache";
import solc from "solc";
import { ethers } from "ethers";

const require = createRequire(import.meta.url);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(testDir, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(projectDir, relativePath), "utf8");
}

function findImports(importPath) {
  try {
    const resolvedPath = importPath.startsWith("@")
      ? require.resolve(importPath, { paths: [projectDir] })
      : path.join(projectDir, importPath);
    return { contents: fs.readFileSync(resolvedPath, "utf8") };
  } catch (error) {
    return { error: `Unable to resolve ${importPath}: ${error.message}` };
  }
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/PriceOracle.sol": { content: readSource("contracts/PriceOracle.sol") },
      "test/MockAggregator.sol": { content: readSource("test/MockAggregator.sol") },
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

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
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

async function expectRevert(action) {
  try {
    await action();
  } catch (error) {
    assert.match(String(error), /CALL_EXCEPTION|revert|transaction execution reverted/);
    return;
  }
  assert.fail("Expected transaction to revert");
}

function parsedLogs(contract, receipt) {
  return receipt.logs.flatMap((log) => {
    try {
      return [contract.interface.parseLog(log)];
    } catch {
      return [];
    }
  });
}

const contracts = compileContracts();
const provider = new ethers.BrowserProvider(
  ganache.provider({
    logging: { quiet: true },
    wallet: { totalAccounts: 3, defaultBalance: 1000 },
  }),
);

const [owner, outsider] = await Promise.all([0, 1].map((index) => provider.getSigner(index)));
const primary = await deploy(contracts, owner, "MockAggregator", [8]);
const fallback = await deploy(contracts, owner, "MockAggregator", [8]);
const oracle = await deploy(contracts, owner, "PriceOracle", [await primary.getAddress()]);
await (await oracle.setFallbackFeed(await fallback.getAddress())).wait();

async function now() {
  return BigInt((await provider.getBlock("latest")).timestamp);
}

async function setFeed(feed, roundId, answer, updatedAt, answeredInRound = roundId) {
  await (await feed.setRoundData(roundId, answer, updatedAt, updatedAt, answeredInRound)).wait();
}

const current = await now();
await setFeed(primary, 1n, 2_000_00000000n, current);
assert.equal(await oracle.getLatestPrice.staticCall(), 2_000_00000000n);
assert.equal(await oracle.getDecimals(), 8n);

const staleUpdatedAt = current - 4_000n;
await setFeed(primary, 2n, 1_900_00000000n, staleUpdatedAt);
await setFeed(fallback, 3n, 2_100_00000000n, current);
assert.equal(await oracle.getLatestPrice.staticCall(), 2_100_00000000n);
const fallbackReceipt = await (await oracle.getLatestPrice()).wait();
const staleEvents = parsedLogs(oracle, fallbackReceipt).filter((entry) => entry.name === "StalePrice");
assert.equal(staleEvents.length, 1);
assert.equal(staleEvents[0].args.updatedAt, staleUpdatedAt);

await setFeed(primary, 4n, -1n, current);
await expectRevert(() => oracle.getLatestPrice.staticCall());

await setFeed(primary, 5n, 2_000_00000000n, current, 4n);
await expectRevert(() => oracle.getLatestPrice.staticCall());

await setFeed(primary, 6n, 2_000_00000000n, staleUpdatedAt);
await setFeed(fallback, 7n, 2_100_00000000n, staleUpdatedAt);
await expectRevert(() => oracle.getLatestPrice.staticCall());

await expectRevert(() => oracle.connect(outsider).setMaxStaleness(7200n));
await (await oracle.setMaxStaleness(7200n)).wait();
assert.equal(await oracle.MAX_STALENESS(), 7200n);

console.log("PriceOracle staleness and fallback regressions passed");
