import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const externalModules = process.env.SOLIDITY_TEST_NODE_MODULES;
const require = createRequire(
  externalModules
    ? path.join(externalModules, "package.json")
    : import.meta.url
);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const solidityDir = path.resolve(testDir, "..");
const repoRoot = path.resolve(solidityDir, "..");
const externalRoot = externalModules
  ? path.join(externalModules, "node_modules")
  : path.join(solidityDir, "node_modules");

const solc = require("solc");
const ganache = require("ganache");
const { ethers } = require("ethers");

const vaultSource = fs.readFileSync(
  path.join(solidityDir, "contracts", "YieldVault.sol"),
  "utf8"
);

const tokenSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
`;

function findImport(importPath) {
  const candidates = [
    path.join(repoRoot, importPath),
    path.join(externalRoot, importPath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }
  return { error: `Import not found: ${importPath}` };
}

function compile() {
  const input = {
    language: "Solidity",
    sources: {
      "YieldVault.sol": { content: vaultSource },
      "MockToken.sol": { content: tokenSource },
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

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), { import: findImport })
  );
  const errors = (output.errors ?? []).filter(
    (error) => error.severity === "error"
  );
  assert.equal(errors.length, 0, errors.map((error) => error.formattedMessage).join("\n"));
  return output.contracts;
}

async function deploy(factory, signer, ...args) {
  const contract = await factory.connect(signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function expectRejects(promise, expectedMessage) {
  await assert.rejects(
    promise,
    (error) => String(error).includes(expectedMessage),
    `Expected revert containing ${expectedMessage}`
  );
}

async function increase(provider, seconds) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

async function setup() {
  const contracts = compile();
  const provider = new ethers.BrowserProvider(
    ganache.provider({ logging: { quiet: true } })
  );
  const [owner, alice, bob] = await Promise.all([
    provider.getSigner(0),
    provider.getSigner(1),
    provider.getSigner(2),
  ]);

  const tokenArtifact = contracts["MockToken.sol"].MockToken;
  const vaultArtifact = contracts["YieldVault.sol"].YieldVault;
  const Token = new ethers.ContractFactory(
    tokenArtifact.abi,
    tokenArtifact.evm.bytecode.object,
    owner
  );
  const Vault = new ethers.ContractFactory(
    vaultArtifact.abi,
    vaultArtifact.evm.bytecode.object,
    owner
  );

  const staking = await deploy(Token, owner, "Stake Token", "STK");
  const reward = await deploy(Token, owner, "Reward Token", "RWD");
  const vault = await deploy(Vault, owner, await staking.getAddress(), await reward.getAddress());

  const stakeAmount = ethers.parseEther("10000");
  const rewardAmount = ethers.parseEther("10000");
  for (const signer of [alice, bob]) {
    const address = await signer.getAddress();
    await (await staking.mint(address, stakeAmount)).wait();
    await (await staking.connect(signer).approve(await vault.getAddress(), stakeAmount)).wait();
  }
  await (await reward.mint(await vault.getAddress(), rewardAmount)).wait();

  return { provider, owner, alice, bob, staking, reward, vault };
}

async function run() {
  {
    const { provider, owner, alice, vault } = await setup();
    await (await vault.connect(alice).deposit(ethers.parseEther("100"))).wait();
    await (await vault.connect(owner).notifyRewardAmount(ethers.parseEther("1000"), 1000)).wait();
    await increase(provider, 100);

    const earned = await vault.earned(await alice.getAddress());
    assert.ok(
      earned >= ethers.parseEther("99") && earned <= ethers.parseEther("103"),
      `unexpected active accrual: ${earned}`
    );
  }

  {
    const { provider, owner, alice, bob, vault } = await setup();
    await (await vault.connect(alice).deposit(ethers.parseEther("100"))).wait();
    await (await vault.connect(owner).notifyRewardAmount(ethers.parseEther("1000"), 1000)).wait();
    await increase(provider, 1500);

    const earnedAtEnd = await vault.earned(await alice.getAddress());
    const rptAtEnd = await vault.rewardPerToken();
    await increase(provider, 500);
    assert.equal(await vault.earned(await alice.getAddress()), earnedAtEnd);
    assert.equal(await vault.rewardPerToken(), rptAtEnd);

    await (await vault.connect(bob).deposit(ethers.parseEther("10"))).wait();
    await increase(provider, 100);
    assert.equal(await vault.earned(await bob.getAddress()), 0n);
  }

  {
    const { owner, alice, vault } = await setup();
    await expectRejects(
      vault.connect(alice).notifyRewardAmount.staticCall(ethers.parseEther("1000"), 1000),
      "Not distributor"
    );
    await expectRejects(
      vault.connect(owner).notifyRewardAmount.staticCall(0, 1000),
      "Invalid reward"
    );
    await expectRejects(
      vault.connect(owner).notifyRewardAmount.staticCall(ethers.parseEther("1000"), 0),
      "Invalid duration"
    );
  }

  {
    const { provider, owner, alice, vault } = await setup();
    const reward = ethers.parseEther("1000");
    const duration = 333n;
    await (await vault.connect(alice).deposit(ethers.parseEther("1"))).wait();
    await (await vault.connect(owner).notifyRewardAmount(reward, duration)).wait();
    await increase(provider, Number(duration));

    const earned = await vault.earned(await alice.getAddress());
    const error = earned > reward ? earned - reward : reward - earned;
    assert.ok(error * 10000n <= reward, `precision error too high: ${earned}`);
  }

  {
    const { provider, owner, alice, reward, vault } = await setup();
    const stake = ethers.parseEther("250");
    await (await vault.connect(alice).deposit(stake)).wait();
    await (await vault.connect(owner).notifyRewardAmount(ethers.parseEther("500"), 500)).wait();
    await increase(provider, 250);

    const beforeReward = await reward.balanceOf(await alice.getAddress());
    await (await vault.connect(alice).claimReward()).wait();
    assert.ok(await reward.balanceOf(await alice.getAddress()) > beforeReward);
  }

  {
    const { alice, staking, vault } = await setup();
    const stake = ethers.parseEther("250");
    await (await vault.connect(alice).deposit(stake)).wait();
    const beforeStake = await staking.balanceOf(await alice.getAddress());
    assert.equal(await vault.balanceOf(await alice.getAddress()), stake);
    assert.equal(await staking.balanceOf(await vault.getAddress()), stake);
    await (await vault.connect(alice).withdraw(stake)).wait();
    assert.equal(await staking.balanceOf(await alice.getAddress()), beforeStake + stake);
    assert.equal(await vault.balanceOf(await alice.getAddress()), 0n);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
