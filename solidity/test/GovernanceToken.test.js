const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const contractPath = path.join(__dirname, "..", "contracts", "GovernanceToken.sol");
const source = fs.readFileSync(contractPath, "utf8");

let server;
let provider;
let accounts;
let compiled;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function resolveOpenZeppelinImport(importPath) {
  const packageJson = require.resolve("@openzeppelin/contracts/package.json");
  const root = path.dirname(packageJson);
  const direct = path.join(root, importPath.replace(/^@openzeppelin\/contracts\//, ""));
  if (fs.existsSync(direct)) {
    return fs.readFileSync(direct, "utf8");
  }

  const suffix = importPath.replace(/^(\.\.\/|\.\/)+/, "").replace(/\\/g, "/");
  const match = walk(root).find((file) => file.replace(/\\/g, "/").endsWith(suffix));
  if (match) {
    return fs.readFileSync(match, "utf8");
  }
  throw new Error(`Unable to resolve import: ${importPath}`);
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/GovernanceToken.sol": { content: source },
      "test/GovernanceTokenHarness.sol": {
        content: `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/GovernanceToken.sol";

contract GovernanceTokenPhishing {
    GovernanceToken private immutable token;

    constructor(GovernanceToken token_) {
        token = token_;
    }

    function phishDelegate(address to) external {
        token.delegateVote(to);
    }

    function phishSnapshot() external {
        token.snapshot();
    }
}

contract GovernanceTokenDelegationWallet {
    GovernanceToken private immutable token;

    constructor(GovernanceToken token_) {
        token = token_;
    }

    function delegateTo(address to) external {
        token.delegateVote(to);
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
        if (importPath === "../contracts/GovernanceToken.sol") {
          return { contents: source };
        }
        return { contents: resolveOpenZeppelinImport(importPath) };
      },
    }),
  );

  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.deepEqual(errors, []);
  return output.contracts;
}

async function deploy(name, signer, args = []) {
  const artifact =
    compiled["contracts/GovernanceToken.sol"]?.[name] ??
    compiled["test/GovernanceTokenHarness.sol"][name];
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.evm.bytecode.object,
    signer,
  );
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function deployToken() {
  const [owner, victim, delegate, attacker] = accounts;
  const token = await deploy("GovernanceToken", owner, [ethers.parseEther("1000")]);
  return { owner, victim, delegate, attacker, token };
}

before(async () => {
  assert.equal(source.includes("tx.origin"), false);
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

test("delegates and revokes voting power for the direct caller", async () => {
  const { victim, delegate, token } = await deployToken();
  const amount = ethers.parseEther("100");

  await token.transfer(victim.address, amount);
  await token.connect(victim).delegateVote(delegate.address);

  assert.equal(await token.delegates(victim.address), delegate.address);
  assert.equal(await token.delegatedPower(delegate.address), amount);
  assert.equal(await token.getVotingPower(victim.address), 0n);
  assert.equal(await token.getVotingPower(delegate.address), amount);

  await token.connect(victim).revokeDelegate();

  assert.equal(await token.delegates(victim.address), ethers.ZeroAddress);
  assert.equal(await token.delegatedPower(delegate.address), 0n);
  assert.equal(await token.getVotingPower(victim.address), amount);
});

test("keeps delegated power in sync when delegated balances move", async () => {
  const { victim, delegate, attacker, token } = await deployToken();
  const amount = ethers.parseEther("100");
  const moved = ethers.parseEther("40");

  await token.transfer(victim.address, amount);
  await token.connect(victim).delegateVote(delegate.address);
  await token.connect(victim).transfer(attacker.address, moved);

  assert.equal(await token.delegatedPower(delegate.address), amount - moved);
  assert.equal(await token.getVotingPower(delegate.address), amount - moved);
  assert.equal(await token.getVotingPower(victim.address), 0n);
  assert.equal(await token.getVotingPower(attacker.address), moved);
});

test("does not let a phishing contract delegate a victim's votes", async () => {
  const { victim, attacker, token } = await deployToken();
  const amount = ethers.parseEther("100");
  const phishing = await deploy("GovernanceTokenPhishing", attacker, [await token.getAddress()]);

  await token.transfer(victim.address, amount);
  await phishing.connect(victim).phishDelegate(attacker.address);

  assert.equal(await token.delegates(victim.address), ethers.ZeroAddress);
  assert.equal(await token.delegatedPower(attacker.address), 0n);
  assert.equal(await token.getVotingPower(attacker.address), 0n);
  assert.equal(await token.getVotingPower(victim.address), amount);
});

test("allows a legitimate contract wallet to delegate its own token balance", async () => {
  const { delegate, token } = await deployToken();
  const amount = ethers.parseEther("75");
  const wallet = await deploy("GovernanceTokenDelegationWallet", delegate, [
    await token.getAddress(),
  ]);
  const walletAddress = await wallet.getAddress();

  await token.transfer(walletAddress, amount);
  await wallet.delegateTo(delegate.address);

  assert.equal(await token.delegates(walletAddress), delegate.address);
  assert.equal(await token.delegatedPower(delegate.address), amount);
  assert.equal(await token.getVotingPower(walletAddress), 0n);
  assert.equal(await token.getVotingPower(delegate.address), amount);
});

test("restricts snapshots to the token owner", async () => {
  const { owner, victim, attacker, token } = await deployToken();
  const phishing = await deploy("GovernanceTokenPhishing", attacker, [await token.getAddress()]);

  await token.connect(owner).snapshot();
  await assert.rejects(token.connect(victim).snapshot());
  await assert.rejects(phishing.connect(owner).phishSnapshot());
});
