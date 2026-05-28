import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ethers } from "ethers";
import ganache from "ganache";
import solc from "solc";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const solidityRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(solidityRoot, "..");

const phishingSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGovernanceToken {
    function delegateVote(address to) external;
}

contract PhishingDelegate {
    IGovernanceToken public token;

    constructor(address tokenAddress) {
        token = IGovernanceToken(tokenAddress);
    }

    function attack(address to) external {
        token.delegateVote(to);
    }
}

contract ContractDelegator {
    IGovernanceToken public token;

    constructor(address tokenAddress) {
        token = IGovernanceToken(tokenAddress);
    }

    function delegateTo(address to) external {
        token.delegateVote(to);
    }
}
`;

function resolveImport(importPath) {
  if (importPath.startsWith("@openzeppelin/")) {
    const resolved = require.resolve(importPath, { paths: [solidityRoot] });
    return { contents: readFileSync(resolved, "utf8") };
  }

  const localPath = path.join(repoRoot, importPath);
  try {
    return { contents: readFileSync(localPath, "utf8") };
  } catch (error) {
    return { error: `Unable to resolve ${importPath}: ${error.message}` };
  }
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "solidity/contracts/GovernanceToken.sol": {
        content: readFileSync(
          path.join(solidityRoot, "contracts", "GovernanceToken.sol"),
          "utf8",
        ),
      },
      "test/Delegators.sol": {
        content: phishingSource,
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

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.deepEqual(errors, []);

  return {
    token: output.contracts["solidity/contracts/GovernanceToken.sol"].GovernanceToken,
    phishing: output.contracts["test/Delegators.sol"].PhishingDelegate,
    contractDelegator: output.contracts["test/Delegators.sol"].ContractDelegator,
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

const source = readFileSync(
  path.join(solidityRoot, "contracts", "GovernanceToken.sol"),
  "utf8",
);
assert.equal(source.includes("tx.origin"), false);

const contracts = compileContracts();
const ganacheProvider = ganache.provider({
  chain: { chainId: 31_337 },
  logging: { quiet: true },
  wallet: { deterministic: true },
});
const provider = new ethers.BrowserProvider(ganacheProvider);
const owner = await provider.getSigner(0);
const victim = await provider.getSigner(1);
const delegatee = await provider.getSigner(2);
const attacker = await provider.getSigner(3);
const ownerAddress = await owner.getAddress();
const victimAddress = await victim.getAddress();
const delegateeAddress = await delegatee.getAddress();
const attackerAddress = await attacker.getAddress();

const token = await deploy(contracts.token, owner, [ethers.parseEther("1000")]);
await (await token.transfer(victimAddress, ethers.parseEther("100"))).wait();

const phishing = await deploy(contracts.phishing, attacker, [await token.getAddress()]);
await (await phishing.connect(victim).attack(attackerAddress)).wait();
assert.equal(await token.delegates(victimAddress), ethers.ZeroAddress);
assert.equal(await token.delegates(await phishing.getAddress()), attackerAddress);
assert.equal(await token.delegatedPower(attackerAddress), 0n);
assert.equal(await token.getVotingPower(attackerAddress), 0n);

await (await token.connect(victim).delegateVote(delegateeAddress)).wait();
assert.equal(await token.delegates(victimAddress), delegateeAddress);
assert.equal(await token.delegatedPower(delegateeAddress), ethers.parseEther("100"));

await (await token.connect(victim).transfer(attackerAddress, ethers.parseEther("40"))).wait();
assert.equal(await token.delegatedPower(delegateeAddress), ethers.parseEther("60"));

await (await token.connect(victim).revokeDelegate()).wait();
assert.equal(await token.delegates(victimAddress), ethers.ZeroAddress);
assert.equal(await token.delegatedPower(delegateeAddress), 0n);

const contractDelegator = await deploy(contracts.contractDelegator, owner, [
  await token.getAddress(),
]);
await (await token.transfer(await contractDelegator.getAddress(), ethers.parseEther("25"))).wait();
await (await contractDelegator.delegateTo(delegateeAddress)).wait();
assert.equal(await token.delegatedPower(delegateeAddress), ethers.parseEther("25"));

await expectRevert(async () => {
  const tx = await token.connect(victim).snapshot();
  await tx.wait();
});
await (await token.connect(owner).snapshot()).wait();

const proposalId = await token.createProposal.staticCall("Ship safe delegation", 3600);
await (await token.createProposal("Ship safe delegation", 3600)).wait();
await (await token.connect(delegatee).vote(proposalId, true)).wait();
const proposal = await token.proposals(proposalId);
assert.equal(proposal.forVotes, await token.getVotingPower(delegateeAddress));
assert.equal(await token.owner(), ownerAddress);

console.log("GovernanceToken tx.origin phishing tests passed");
