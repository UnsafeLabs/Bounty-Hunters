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

const vestingSource = fs.readFileSync(
  path.join(solidityDir, "contracts", "TokenVesting.sol"),
  "utf8"
);

const tokenSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Vesting Token", "VST") {}

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
      "TokenVesting.sol": { content: vestingSource },
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

async function increase(provider, seconds) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

async function expectRejects(promise, expectedMessage) {
  await assert.rejects(
    promise,
    (error) => String(error).includes(expectedMessage),
    `Expected revert containing ${expectedMessage}`
  );
}

async function setup(allocation, cliffDuration = 100n, duration = 1000n) {
  const contracts = compile();
  const provider = new ethers.BrowserProvider(
    ganache.provider({ logging: { quiet: true } })
  );
  const [owner, beneficiary] = await Promise.all([
    provider.getSigner(0),
    provider.getSigner(1),
  ]);

  const tokenArtifact = contracts["MockToken.sol"].MockToken;
  const vestingArtifact = contracts["TokenVesting.sol"].TokenVesting;
  const Token = new ethers.ContractFactory(
    tokenArtifact.abi,
    tokenArtifact.evm.bytecode.object,
    owner
  );
  const Vesting = new ethers.ContractFactory(
    vestingArtifact.abi,
    vestingArtifact.evm.bytecode.object,
    owner
  );

  const token = await deploy(Token, owner);
  const latest = await provider.getBlock("latest");
  const start = BigInt(latest.timestamp) + 10n;
  const vesting = await deploy(
    Vesting,
    owner,
    await token.getAddress(),
    await beneficiary.getAddress(),
    allocation,
    start,
    cliffDuration,
    duration
  );
  await (await token.mint(await vesting.getAddress(), allocation)).wait();

  return { provider, owner, beneficiary, token, vesting, start, cliffDuration, duration, allocation };
}

async function setupWithStart(allocation, start, cliffDuration = 100n, duration = 1000n) {
  const contracts = compile();
  const provider = new ethers.BrowserProvider(
    ganache.provider({ logging: { quiet: true } })
  );
  const [owner, beneficiary] = await Promise.all([
    provider.getSigner(0),
    provider.getSigner(1),
  ]);

  const tokenArtifact = contracts["MockToken.sol"].MockToken;
  const vestingArtifact = contracts["TokenVesting.sol"].TokenVesting;
  const Token = new ethers.ContractFactory(
    tokenArtifact.abi,
    tokenArtifact.evm.bytecode.object,
    owner
  );
  const Vesting = new ethers.ContractFactory(
    vestingArtifact.abi,
    vestingArtifact.evm.bytecode.object,
    owner
  );

  const token = await deploy(Token, owner);
  const vesting = await deploy(
    Vesting,
    owner,
    await token.getAddress(),
    await beneficiary.getAddress(),
    allocation,
    start,
    cliffDuration,
    duration
  );
  await (await token.mint(await vesting.getAddress(), allocation)).wait();

  return { provider, owner, beneficiary, token, vesting, start, cliffDuration, duration, allocation };
}

async function setupWithElapsed(allocation, elapsed, cliffDuration = 0n, duration = 1000n) {
  const contracts = compile();
  const provider = new ethers.BrowserProvider(
    ganache.provider({ logging: { quiet: true } })
  );
  const [owner, beneficiary] = await Promise.all([
    provider.getSigner(0),
    provider.getSigner(1),
  ]);

  const tokenArtifact = contracts["MockToken.sol"].MockToken;
  const vestingArtifact = contracts["TokenVesting.sol"].TokenVesting;
  const Token = new ethers.ContractFactory(
    tokenArtifact.abi,
    tokenArtifact.evm.bytecode.object,
    owner
  );
  const Vesting = new ethers.ContractFactory(
    vestingArtifact.abi,
    vestingArtifact.evm.bytecode.object,
    owner
  );

  const token = await deploy(Token, owner);
  const latest = await provider.getBlock("latest");
  const start = BigInt(latest.timestamp) - elapsed;
  const vesting = await deploy(
    Vesting,
    owner,
    await token.getAddress(),
    await beneficiary.getAddress(),
    allocation,
    start,
    cliffDuration,
    duration
  );
  await (await token.mint(await vesting.getAddress(), allocation)).wait();

  return { provider, owner, beneficiary, token, vesting, start, cliffDuration, duration, allocation };
}

async function moveTo(provider, targetTimestamp) {
  const latest = BigInt((await provider.getBlock("latest")).timestamp);
  if (targetTimestamp > latest) {
    await increase(provider, Number(targetTimestamp - latest));
  } else {
    await provider.send("evm_mine", []);
  }
}

async function run() {
  {
    const allocation = ethers.parseUnits("1000000000", 18);
    const duration = 10_000_000n;
    const elapsedTarget = duration / 2n;
    const currentTime = 1_780_000_000n;
    const start = currentTime - elapsedTarget;
    const { provider, vesting, allocation: total } = await setupWithStart(
      allocation,
      start,
      0n,
      duration
    );
    const vested = await vesting.vestedAmount();
    const latest = BigInt((await provider.getBlock("latest")).timestamp);
    const elapsed = latest - start;
    const expected = total * elapsed / duration;
    const error = vested > expected ? vested - expected : expected - vested;
    assert.ok(error <= 1n, `large allocation vesting error ${error}`);
  }

  {
    const allocation = ethers.parseEther("1000");
    const { owner, beneficiary, token, vesting } = await setup(allocation, 500n, 1000n);
    await (await vesting.connect(owner).revoke()).wait();
    assert.equal(await token.balanceOf(await owner.getAddress()), allocation);
    assert.equal(await token.balanceOf(await beneficiary.getAddress()), 0n);
  }

  {
    const allocation = ethers.parseEther("1000");
    const { provider, owner, beneficiary, token, vesting, start } = await setup(allocation, 100n, 1000n);
    await moveTo(provider, start + 400n);

    const vested = await vesting.vestedAmount();
    await (await vesting.connect(owner).revoke()).wait();

    const beneficiaryPaid = await token.balanceOf(await beneficiary.getAddress());
    const ownerRefund = await token.balanceOf(await owner.getAddress());
    const drift = beneficiaryPaid > vested ? beneficiaryPaid - vested : vested - beneficiaryPaid;
    assert.ok(drift <= ethers.parseEther("2"), `unexpected revoke drift ${drift}`);
    assert.equal(beneficiaryPaid + ownerRefund, allocation);
    await expectRejects(vesting.connect(beneficiary).claim.staticCall(), "Vesting revoked");
  }

  {
    const allocation = ethers.parseEther("1000");
    const { provider, beneficiary, token, vesting, start, duration } = await setup(allocation, 0n, 1000n);
    await moveTo(provider, start + duration);

    assert.equal(await vesting.vestedAmount(), allocation);
    await (await vesting.connect(beneficiary).claim()).wait();
    assert.equal(await token.balanceOf(await beneficiary.getAddress()), allocation);
    assert.equal(await vesting.claimed(), allocation);
  }

  {
    const allocation = 1000n;
    const duration = 333n;
    let last = 0n;
    for (const offset of [1n, 17n, 111n, 222n, 332n]) {
      const { vesting } = await setupWithElapsed(allocation, offset, 0n, duration);
      const vested = await vesting.vestedAmount();
      const expected = allocation * offset / duration;
      const error = vested > expected ? vested - expected : expected - vested;
      assert.ok(error <= 5n, `vesting error ${error} at offset ${offset}`);
      assert.ok(vested >= last, "vesting must be monotonic");
      last = vested;
    }

    const full = await setup(allocation, 0n, duration);
    await moveTo(full.provider, full.start + duration);
    await (await full.vesting.connect(full.beneficiary).claim()).wait();
    assert.equal(await full.token.balanceOf(await full.beneficiary.getAddress()), allocation);
  }

  {
    const allocation = ethers.parseEther("1000");
    const { provider, owner, beneficiary, token, vesting, start } = await setup(allocation, 0n, 1000n);
    await moveTo(provider, start + 250n);
    await (await vesting.connect(beneficiary).claim()).wait();
    const claimed = await vesting.claimed();

    await moveTo(provider, start + 600n);
    const vestedBeforeRevoke = await vesting.vestedAmount();
    await (await vesting.connect(owner).revoke()).wait();

    const beneficiaryPaid = await token.balanceOf(await beneficiary.getAddress());
    const ownerRefund = await token.balanceOf(await owner.getAddress());
    const drift = beneficiaryPaid > vestedBeforeRevoke
      ? beneficiaryPaid - vestedBeforeRevoke
      : vestedBeforeRevoke - beneficiaryPaid;
    assert.ok(drift <= ethers.parseEther("2"), `unexpected partial revoke drift ${drift}`);
    assert.equal(beneficiaryPaid + ownerRefund, allocation);
    assert.equal(await vesting.claimed(), beneficiaryPaid);
    assert.ok(claimed < vestedBeforeRevoke);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
