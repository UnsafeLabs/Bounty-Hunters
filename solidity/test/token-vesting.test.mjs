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
      "contracts/TokenVesting.sol": { content: readSource("contracts/TokenVesting.sol") },
      "test/MockERC20.sol": { content: readSource("test/MockERC20.sol") },
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

async function latestTimestamp(provider) {
  return BigInt((await provider.getBlock("latest")).timestamp);
}

async function increaseTo(provider, timestamp) {
  await provider.send("evm_setTime", [Number(timestamp) * 1000]);
  await provider.send("evm_mine", []);
}

const contracts = compileContracts();
const provider = new ethers.BrowserProvider(
  ganache.provider({
    logging: { quiet: true },
    wallet: { totalAccounts: 4, defaultBalance: 1000 },
  }),
);

const [owner, beneficiary] = await Promise.all([0, 1].map((index) => provider.getSigner(index)));
const ownerAddress = await owner.getAddress();
const beneficiaryAddress = await beneficiary.getAddress();
const token = await deploy(contracts, owner, "MockERC20", ["Vesting Token", "VST"]);

async function newVesting(allocation, cliffDuration = 100n, duration = 1_000n) {
  const start = (await latestTimestamp(provider)) + 10n;
  const vesting = await deploy(contracts, owner, "TokenVesting", [
    await token.getAddress(),
    beneficiaryAddress,
    allocation,
    start,
    cliffDuration,
    duration,
  ]);
  await (await token.mint(await vesting.getAddress(), allocation)).wait();
  return { vesting, start, duration };
}

const maxAllocation = 1_000_000_000n * 10n ** 18n;
{
  const { vesting, start, duration } = await newVesting(maxAllocation, 0n, 365n * 24n * 60n * 60n);
  await increaseTo(provider, start + duration / 2n);
  const vested = await vesting.vestedAmount();
  assert(vested > 0n);
  assert(vested < maxAllocation);
  await increaseTo(provider, start + duration);
  assert.equal(await vesting.vestedAmount(), maxAllocation);
}

{
  const allocation = 1_000n;
  const { vesting, start } = await newVesting(allocation, 100n, 1_000n);
  await increaseTo(provider, start + 50n);
  await (await vesting.revoke()).wait();
  assert.equal(await token.balanceOf(ownerAddress), allocation);
  assert.equal(await token.balanceOf(beneficiaryAddress), 0n);
  assert.equal(await vesting.claimable(), 0n);
}

{
  const allocation = 1_000n;
  const { vesting, start } = await newVesting(allocation, 0n, 1_000n);
  const ownerBefore = await token.balanceOf(ownerAddress);
  await increaseTo(provider, start + 250n);
  await (await vesting.revoke()).wait();
  assert.equal(await token.balanceOf(beneficiaryAddress), 250n);
  assert.equal((await token.balanceOf(ownerAddress)) - ownerBefore, 750n);
}

{
  const allocation = 1_000n;
  const { vesting, start, duration } = await newVesting(allocation, 0n, 333n);
  await increaseTo(provider, start + 100n);
  const vested = await vesting.vestedAmount();
  const ideal = allocation * 100n / 333n;
  assert(vested >= ideal && vested <= ideal + 1n);
  await increaseTo(provider, start + duration);
  await (await vesting.connect(beneficiary).claim()).wait();
  assert.equal(await token.balanceOf(beneficiaryAddress), 1_250n);
  assert.equal(await vesting.claimed(), allocation);
}

console.log("TokenVesting overflow and revocation regressions passed");
