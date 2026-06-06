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
      "contracts/YieldVault.sol": { content: readSource("contracts/YieldVault.sol") },
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

async function expectRevert(action) {
  try {
    await action();
  } catch (error) {
    assert.match(String(error), /CALL_EXCEPTION|revert|transaction execution reverted/);
    return;
  }
  assert.fail("Expected transaction to revert");
}

const contracts = compileContracts();
const provider = new ethers.BrowserProvider(
  ganache.provider({
    logging: { quiet: true },
    wallet: { totalAccounts: 4, defaultBalance: 1000 },
  }),
);

const [owner, staker, outsider] = await Promise.all([0, 1, 2].map((index) => provider.getSigner(index)));
const stakerAddress = await staker.getAddress();
const stakingToken = await deploy(contracts, owner, "MockERC20", ["Stake Token", "STK"]);
const rewardToken = await deploy(contracts, owner, "MockERC20", ["Reward Token", "RWD"]);
const vault = await deploy(contracts, owner, "YieldVault", [
  await stakingToken.getAddress(),
  await rewardToken.getAddress(),
]);

const stakeAmount = 1_000n * 10n ** 18n;
const rewardAmount = 1_000n * 10n ** 18n;
const duration = 1_000n;

await (await stakingToken.mint(stakerAddress, stakeAmount)).wait();
await (await rewardToken.mint(await vault.getAddress(), rewardAmount)).wait();
await (await stakingToken.connect(staker).approve(await vault.getAddress(), stakeAmount)).wait();

await expectRevert(() => vault.connect(outsider).notifyRewardAmount(rewardAmount, duration));
await (await vault.notifyRewardAmount(rewardAmount, duration)).wait();
const periodFinish = await vault.periodFinish();

await (await vault.connect(staker).deposit(stakeAmount)).wait();

await increaseTo(provider, (await latestTimestamp(provider)) + 500n);
const earnedHalf = await vault.earned(stakerAddress);
const expectedHalf = rewardAmount / 2n;
const tolerance = rewardAmount / 10_000n;
assert(earnedHalf >= expectedHalf - tolerance && earnedHalf <= expectedHalf + tolerance);

await increaseTo(provider, periodFinish + 200n);
const earnedAtEnd = await vault.earned(stakerAddress);
await increaseTo(provider, periodFinish + 800n);
assert.equal(await vault.earned(stakerAddress), earnedAtEnd);

const stakerRewardBefore = await rewardToken.balanceOf(stakerAddress);
await (await vault.connect(staker).claimReward()).wait();
const paid = (await rewardToken.balanceOf(stakerAddress)) - stakerRewardBefore;
assert(paid >= rewardAmount - tolerance && paid <= rewardAmount);

await (await vault.connect(staker).withdraw(stakeAmount)).wait();
assert.equal(await vault.totalSupply(), 0n);
assert.equal(await vault.balanceOf(stakerAddress), 0n);
assert.equal(await stakingToken.balanceOf(stakerAddress), stakeAmount);

console.log("YieldVault reward accrual regressions passed");
