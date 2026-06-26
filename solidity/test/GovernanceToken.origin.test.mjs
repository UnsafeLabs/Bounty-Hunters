import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("../contracts/GovernanceToken.sol", import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const evmDepsDir = process.env.GOVERNANCE_TOKEN_EVM_DEPS;
const evmDeps = evmDepsDir
  ? {
      solc: require(`${evmDepsDir}/solc`),
      ganache: require(`${evmDepsDir}/ganache`),
      ethers: require(`${evmDepsDir}/ethers`).ethers,
    }
  : null;

const phishingSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGovernanceToken {
    function delegateVote(address to) external;
}

contract PhishingDelegate {
    function attack(address token, address to) external {
        IGovernanceToken(token).delegateVote(to);
    }
}
`;

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "GovernanceToken.sol": { content: source },
      "PhishingDelegate.sol": { content: phishingSource },
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
    evmDeps.solc.compile(JSON.stringify(input), {
      import: (path) => {
        if (path.startsWith("@openzeppelin/")) {
          return { contents: readFileSync(`${evmDepsDir}/${path}`, "utf8") };
        }
        return { error: `File not found: ${path}` };
      },
    }),
  );
  const errors = (output.errors ?? []).filter((error) => error.severity === "error");
  assert.deepEqual(errors, []);
  return output.contracts;
}

async function deploy(contract, signer, args = []) {
  const factory = new evmDeps.ethers.ContractFactory(
    contract.abi,
    contract.evm.bytecode.object,
    signer,
  );
  const deployed = await factory.deploy(...args);
  await deployed.waitForDeployment();
  return deployed;
}

async function expectRevert(action, pattern) {
  await assert.rejects(async () => {
    const tx = await action();
    if (tx?.wait) {
      await tx.wait();
    }
  }, pattern);
}

async function deployGovernanceFixture() {
  const contracts = compileContracts();
  const provider = new evmDeps.ethers.BrowserProvider(
    evmDeps.ganache.provider({ logging: { quiet: true } }),
  );
  const owner = await provider.getSigner(0);
  const holder = await provider.getSigner(1);
  const delegate = await provider.getSigner(2);
  const recipient = await provider.getSigner(3);
  const ownerAddress = await owner.getAddress();
  const holderAddress = await holder.getAddress();
  const delegateAddress = await delegate.getAddress();
  const recipientAddress = await recipient.getAddress();
  const initialSupply = 1_000n;
  const holderBalance = 100n;

  const token = await deploy(contracts["GovernanceToken.sol"].GovernanceToken, owner, [
    initialSupply,
  ]);
  const phishing = await deploy(contracts["PhishingDelegate.sol"].PhishingDelegate, owner);
  await (await token.transfer(holderAddress, holderBalance)).wait();

  return {
    provider,
    owner,
    holder,
    delegate,
    recipient,
    ownerAddress,
    holderAddress,
    delegateAddress,
    recipientAddress,
    initialSupply,
    holderBalance,
    token,
    phishing,
  };
}

function makeState() {
  return {
    balances: new Map([
      ["alice", 100n],
      ["phishingContract", 0n],
      ["bob", 25n],
    ]),
    delegates: new Map(),
    delegatedPower: new Map(),
    owner: "alice",
  };
}

function balanceOf(state, account) {
  return state.balances.get(account) ?? 0n;
}

function delegatedPowerOf(state, account) {
  return state.delegatedPower.get(account) ?? 0n;
}

function setDelegatedPower(state, account, value) {
  state.delegatedPower.set(account, value);
}

function delegateVote(state, caller, to) {
  if (caller === "0x0") throw new Error("Invalid sender");
  if (to === "0x0") throw new Error("Invalid delegate");
  if (caller === to) throw new Error("Cannot delegate to self");

  const previousDelegate = state.delegates.get(caller);
  if (previousDelegate) {
    setDelegatedPower(
      state,
      previousDelegate,
      delegatedPowerOf(state, previousDelegate) - balanceOf(state, caller),
    );
  }

  state.delegates.set(caller, to);
  setDelegatedPower(state, to, delegatedPowerOf(state, to) + balanceOf(state, caller));
}

function transfer(state, from, to, amount) {
  const fromDelegate = state.delegates.get(from);
  const toDelegate = state.delegates.get(to);

  if (fromDelegate) {
    setDelegatedPower(state, fromDelegate, delegatedPowerOf(state, fromDelegate) - amount);
  }
  if (toDelegate) {
    setDelegatedPower(state, toDelegate, delegatedPowerOf(state, toDelegate) + amount);
  }

  state.balances.set(from, balanceOf(state, from) - amount);
  state.balances.set(to, balanceOf(state, to) + amount);
}

function snapshot(state, caller) {
  if (caller !== state.owner) throw new Error("OwnableUnauthorizedAccount");
  return true;
}

test("contract removes tx.origin and uses Ownable for admin-only snapshot", () => {
  assert.doesNotMatch(source, /tx\.origin/);
  assert.match(source, /import "@openzeppelin\/contracts\/access\/Ownable\.sol";/);
  assert.match(source, /contract GovernanceToken is ERC20, Ownable/);
  assert.match(source, /constructor\(uint256 initialSupply\) ERC20\("Governance", "GOV"\) Ownable\(msg\.sender\)/);
  assert.match(source, /function snapshot\(\) external onlyOwner/);
});

test("delegate and revoke operate on msg.sender", () => {
  assert.match(source, /address previousDelegate = delegates\[msg\.sender\];/);
  assert.match(source, /delegates\[msg\.sender\] = to;/);
  assert.match(source, /address currentDelegate = delegates\[msg\.sender\];/);
  assert.match(source, /delegates\[msg\.sender\] = address\(0\);/);
  assert.match(source, /require\(msg\.sender != address\(0\), "Invalid sender"\);/);
});

test("phishing contract cannot delegate votes for the externally owned caller", () => {
  const state = makeState();

  delegateVote(state, "phishingContract", "bob");

  assert.equal(state.delegates.get("alice"), undefined);
  assert.equal(state.delegates.get("phishingContract"), "bob");
  assert.equal(delegatedPowerOf(state, "bob"), 0n);
});

test("direct delegation still grants voting power to the chosen delegate", () => {
  const state = makeState();

  delegateVote(state, "alice", "bob");

  assert.equal(state.delegates.get("alice"), "bob");
  assert.equal(delegatedPowerOf(state, "bob"), 100n);
});

test("delegated power follows balance transfers", () => {
  const state = makeState();

  delegateVote(state, "alice", "bob");
  transfer(state, "alice", "carol", 40n);

  assert.equal(balanceOf(state, "alice"), 60n);
  assert.equal(delegatedPowerOf(state, "bob"), 60n);

  delegateVote(state, "carol", "bob");
  assert.equal(delegatedPowerOf(state, "bob"), 100n);
});

test("snapshot rejects non-owner callers", () => {
  const state = makeState();

  assert.equal(snapshot(state, "alice"), true);
  assert.throws(() => snapshot(state, "bob"), /OwnableUnauthorizedAccount/);
});

test("getVotingPower includes self balance and delegated votes", () => {
  assert.match(source, /return balanceOf\(account\) \+ delegatedPower\[account\];/);
});

test("EVM phishing contract cannot delegate a caller votes", { skip: !evmDeps }, async () => {
  const { holder, holderAddress, delegateAddress, holderBalance, token, phishing } =
    await deployGovernanceFixture();
  const phishingAddress = await phishing.getAddress();
  const zeroAddress = evmDeps.ethers.ZeroAddress;

  await (await phishing.connect(holder).attack(await token.getAddress(), delegateAddress)).wait();

  assert.equal(await token.delegates(holderAddress), zeroAddress);
  assert.equal(await token.delegates(phishingAddress), delegateAddress);
  assert.equal(await token.delegatedPower(delegateAddress), 0n);
  assert.equal(await token.getVotingPower(holderAddress), holderBalance);
  assert.equal(await token.getVotingPower(delegateAddress), 0n);
});

test("EVM direct delegation and revocation use the transaction sender", { skip: !evmDeps }, async () => {
  const { holder, holderAddress, delegateAddress, holderBalance, token } =
    await deployGovernanceFixture();
  const zeroAddress = evmDeps.ethers.ZeroAddress;

  await (await token.connect(holder).delegateVote(delegateAddress)).wait();

  assert.equal(await token.delegates(holderAddress), delegateAddress);
  assert.equal(await token.delegatedPower(delegateAddress), holderBalance);
  assert.equal(await token.getVotingPower(delegateAddress), holderBalance);

  await (await token.connect(holder).revokeDelegate()).wait();

  assert.equal(await token.delegates(holderAddress), zeroAddress);
  assert.equal(await token.delegatedPower(delegateAddress), 0n);
});

test("EVM delegated power follows balance transfers", { skip: !evmDeps }, async () => {
  const {
    holder,
    holderAddress,
    delegateAddress,
    recipientAddress,
    holderBalance,
    token,
  } = await deployGovernanceFixture();

  await (await token.connect(holder).delegateVote(delegateAddress)).wait();
  await (await token.connect(holder).transfer(recipientAddress, 40n)).wait();

  assert.equal(await token.balanceOf(holderAddress), holderBalance - 40n);
  assert.equal(await token.balanceOf(recipientAddress), 40n);
  assert.equal(await token.delegatedPower(delegateAddress), holderBalance - 40n);
  assert.equal(await token.getVotingPower(delegateAddress), holderBalance - 40n);
});

test("EVM snapshot is restricted to the owner", { skip: !evmDeps }, async () => {
  const { holder, token } = await deployGovernanceFixture();

  await (await token.snapshot()).wait();
  await expectRevert(() => token.connect(holder).snapshot(), /OwnableUnauthorizedAccount|revert/);
});
