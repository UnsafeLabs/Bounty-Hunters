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
      "contracts/StakingVault.sol": { content: readSource("contracts/StakingVault.sol") },
      "test/MockERC20.sol": { content: readSource("test/MockERC20.sol") },
      "test/StakingVaultAttack.sol": { content: readSource("test/StakingVaultAttack.sol") },
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

const contracts = compileContracts();
const provider = new ethers.BrowserProvider(
  ganache.provider({
    logging: { quiet: true },
    wallet: { totalAccounts: 4, defaultBalance: 1000 },
  }),
);

const [owner, staker] = await Promise.all([0, 1].map((index) => provider.getSigner(index)));
const stakerAddress = await staker.getAddress();

const token = await deploy(contracts, owner, "MockERC20", ["Stake Token", "STK"]);
const vault = await deploy(contracts, owner, "StakingVault", [await token.getAddress(), 1_000_000_000_000_000_000n]);

await (await owner.sendTransaction({ to: await vault.getAddress(), value: 50_000n })).wait();
await (await token.mint(stakerAddress, 1_000n)).wait();
await (await token.connect(staker).approve(await vault.getAddress(), 1_000n)).wait();
await (await vault.connect(staker).stake(1_000n)).wait();

await provider.send("evm_increaseTime", [5]);
await provider.send("evm_mine", []);
await (await vault.connect(staker).claimRewards()).wait();
assert.equal(await vault.rewards(stakerAddress), 0n);

await (await vault.connect(staker).withdraw(200n)).wait();
assert.equal(await vault.getStakedBalance(stakerAddress), 800n);
assert.equal(await vault.totalStaked(), 800n);

const attackVault = await deploy(contracts, owner, "StakingVault", [await token.getAddress(), 0n]);
const attacker = await deploy(contracts, owner, "ReentrantWithdrawAttacker", [
  await attackVault.getAddress(),
  await token.getAddress(),
]);
await (await owner.sendTransaction({ to: await attackVault.getAddress(), value: 1_000n })).wait();
await (await token.mint(await attacker.getAddress(), 100n)).wait();

await (await attacker.attackWithdraw(100n)).wait();

assert.equal(await attacker.reentryAttempts(), 1n);
assert.equal(await attacker.reentrySucceeded(), false);
assert.equal(await attackVault.getStakedBalance(await attacker.getAddress()), 0n);
assert.equal(await attackVault.totalStaked(), 0n);
assert.equal(await provider.getBalance(await attacker.getAddress()), 100n);

console.log("StakingVault reentrancy regressions passed");
