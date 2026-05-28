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
const root = path.resolve(__dirname, "..");

const mockERC20Source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockERC20 {
    string public name = "Mock Token";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 amount);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}`;

function compileContracts() {
  const tokenVestingPath = path.join(root, "contracts", "TokenVesting.sol");
  const input = {
    language: "Solidity",
    sources: {
      "TokenVesting.sol": {
        content: readFileSync(tokenVestingPath, "utf8"),
      },
      "MockERC20.sol": {
        content: mockERC20Source,
      },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
        },
      },
    },
  };

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (importPath) => {
        try {
          const resolved = require.resolve(importPath, { paths: [root] });
          return { contents: readFileSync(resolved, "utf8") };
        } catch {
          return { error: `Import not found: ${importPath}` };
        }
      },
    }),
  );

  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.deepEqual(errors, []);
  return {
    token: output.contracts["MockERC20.sol"].MockERC20,
    vesting: output.contracts["TokenVesting.sol"].TokenVesting,
  };
}

async function deploy(factory, signer, args = []) {
  const contract = await new ethers.ContractFactory(
    factory.abi,
    factory.evm.bytecode.object,
    signer,
  ).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function latestTimestamp(provider) {
  const block = await provider.getBlock("latest");
  return BigInt(block.timestamp);
}

async function setTimestamp(provider, evmProvider, timestamp) {
  const now = await latestTimestamp(provider);
  assert(timestamp >= now, "cannot move EVM time backwards");
  await evmProvider.request({
    method: "evm_setTime",
    params: [Number(timestamp) * 1_000],
  });
  await evmProvider.request({ method: "evm_mine", params: [] });
}

describe("TokenVesting", function () {
  let compiled;
  let ganacheProvider;
  let provider;
  let owner;
  let beneficiary;

  before(function () {
    compiled = compileContracts();
  });

  beforeEach(async function () {
    ganacheProvider = ganache.provider({
      logging: { quiet: true },
      wallet: { totalAccounts: 4 },
    });
    provider = new ethers.BrowserProvider(ganacheProvider);
    owner = await provider.getSigner(0);
    beneficiary = await provider.getSigner(1);
  });

  async function deployFundedVesting({
    allocation = 1_000n,
    start,
    cliffDuration = 0n,
    duration = 100n,
  } = {}) {
    const token = await deploy(compiled.token, owner);
    const now = await latestTimestamp(provider);
    const vestingStart = start ?? now + 100n;
    const vesting = await deploy(compiled.vesting, owner, [
      await token.getAddress(),
      await beneficiary.getAddress(),
      allocation,
      vestingStart,
      cliffDuration,
      duration,
    ]);
    await (await token.mint(await vesting.getAddress(), allocation)).wait();
    return { token, vesting, start: vestingStart, duration };
  }

  it("does not overflow for maximum allocation over a long vesting schedule", async function () {
    const allocation = ethers.MaxUint256;
    const duration = 10_000_000n;
    const { vesting, start } = await deployFundedVesting({ allocation, duration });

    await setTimestamp(provider, ganacheProvider, start + duration / 2n);

    const vested = await vesting.vestedAmount();
    assert.equal(vested, allocation / 2n);
  });

  it("returns the full remainder at vesting completion", async function () {
    const allocation = 10n;
    const duration = 3n;
    const { vesting, start } = await deployFundedVesting({ allocation, duration });

    await setTimestamp(provider, ganacheProvider, start + 1n);
    assert.equal(await vesting.vestedAmount(), 3n);

    await setTimestamp(provider, ganacheProvider, start + 2n);
    assert.equal(await vesting.vestedAmount(), 6n);

    await setTimestamp(provider, ganacheProvider, start + duration);
    assert.equal(await vesting.vestedAmount(), allocation);
  });

  it("tracks the linear vesting curve within one token unit", async function () {
    const allocation = 1_000n;
    const duration = 97n;
    const { vesting, start } = await deployFundedVesting({ allocation, duration });

    for (const elapsed of [1n, 7n, 17n, 31n, 49n, 73n, 96n]) {
      await setTimestamp(provider, ganacheProvider, start + elapsed);
      const actual = await vesting.vestedAmount();
      const expected = (allocation * elapsed) / duration;
      const error = actual > expected ? actual - expected : expected - actual;
      assert.ok(error <= 1n, `elapsed ${elapsed}: error ${error}`);
    }
  });

  it("lets the beneficiary claim the complete allocation at vesting end", async function () {
    const allocation = 10n;
    const { token, vesting, start, duration } = await deployFundedVesting({
      allocation,
      duration: 3n,
    });

    await setTimestamp(provider, ganacheProvider, start + duration);
    await (await vesting.connect(beneficiary).claim()).wait();

    assert.equal(await token.balanceOf(await beneficiary.getAddress()), allocation);
    assert.equal(await vesting.claimed(), allocation);
  });

  it("returns all unclaimed tokens to the owner when revoked during the cliff", async function () {
    const allocation = 1_000n;
    const cliffDuration = 50n;
    const { token, vesting, start } = await deployFundedVesting({
      allocation,
      cliffDuration,
      duration: 100n,
    });

    await setTimestamp(provider, ganacheProvider, start + cliffDuration - 1n);
    await (await vesting.revoke()).wait();

    assert.equal(await token.balanceOf(await owner.getAddress()), allocation);
    assert.equal(await token.balanceOf(await beneficiary.getAddress()), 0n);
    assert.equal(await vesting.claimable(), 0n);
    await assert.rejects(vesting.connect(beneficiary).claim(), /revert/);
  });

  it("sends vested unclaimed tokens to beneficiary and only unvested tokens to owner when revoked post-cliff", async function () {
    const allocation = 1_000n;
    const { token, vesting, start } = await deployFundedVesting({
      allocation,
      cliffDuration: 10n,
      duration: 100n,
    });

    await setTimestamp(provider, ganacheProvider, start + 25n);
    await (await vesting.connect(beneficiary).claim()).wait();
    assert.equal(await token.balanceOf(await beneficiary.getAddress()), 250n);

    await setTimestamp(provider, ganacheProvider, start + 60n);
    await (await vesting.revoke()).wait();

    assert.equal(await token.balanceOf(await beneficiary.getAddress()), 600n);
    assert.equal(await token.balanceOf(await owner.getAddress()), 400n);
    assert.equal(await vesting.claimable(), 0n);
  });
});
