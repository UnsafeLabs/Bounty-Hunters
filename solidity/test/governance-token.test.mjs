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
  const governanceSource = readSource("contracts/GovernanceToken.sol");
  assert.equal(governanceSource.includes("tx.origin"), false, "tx.origin must not remain");

  const input = {
    language: "Solidity",
    sources: {
      "contracts/GovernanceToken.sol": { content: governanceSource },
      "test/GovernanceDelegationHarness.sol": {
        content: readSource("test/GovernanceDelegationHarness.sol"),
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

const contracts = compileContracts();
const provider = new ethers.BrowserProvider(
  ganache.provider({
    logging: { quiet: true },
    wallet: { totalAccounts: 5, defaultBalance: 1000 },
  }),
);

const [owner, victim, attacker, delegatee, outsider] = await Promise.all(
  [0, 1, 2, 3, 4].map((index) => provider.getSigner(index)),
);
const ownerAddress = await owner.getAddress();
const victimAddress = await victim.getAddress();
const attackerAddress = await attacker.getAddress();
const delegateeAddress = await delegatee.getAddress();
const outsiderAddress = await outsider.getAddress();

const governance = await deploy(contracts, owner, "GovernanceToken", [1_000_000n]);
const phishing = await deploy(contracts, owner, "PhishingDelegate");
const contractWallet = await deploy(contracts, owner, "ContractWalletDelegate");

await (await governance.transfer(victimAddress, 1_000n)).wait();
await (await governance.transfer(await contractWallet.getAddress(), 500n)).wait();

await (await phishing.connect(victim).trick(await governance.getAddress(), attackerAddress)).wait();
assert.equal(await governance.delegates(victimAddress), ethers.ZeroAddress);
assert.equal(await governance.delegates(await phishing.getAddress()), attackerAddress);
assert.equal(await governance.getVotingPower(attackerAddress), 0n);

await (await governance.connect(victim).delegateVote(delegateeAddress)).wait();
assert.equal(await governance.delegates(victimAddress), delegateeAddress);
assert.equal(await governance.getVotingPower(delegateeAddress), 1_000n);

await (await governance.connect(victim).transfer(attackerAddress, 400n)).wait();
assert.equal(await governance.getVotingPower(delegateeAddress), 600n);
assert.equal(await governance.getVotingPower(attackerAddress), 400n);

await (await governance.connect(victim).revokeDelegate()).wait();
assert.equal(await governance.delegates(victimAddress), ethers.ZeroAddress);
assert.equal(await governance.getVotingPower(delegateeAddress), 0n);

await (await contractWallet.delegate(await governance.getAddress(), delegateeAddress)).wait();
assert.equal(await governance.delegates(await contractWallet.getAddress()), delegateeAddress);
assert.equal(await governance.getVotingPower(delegateeAddress), 500n);

await expectRevert(() => governance.connect(outsider).snapshot());
await (await governance.connect(owner).snapshot()).wait();
assert.equal(await governance.owner(), ownerAddress);

console.log("GovernanceToken tx.origin phishing regressions passed");
