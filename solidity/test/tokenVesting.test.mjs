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

const mockTokenSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory n, string memory s, uint256 supply) {
        name = n;
        symbol = s;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}`;

function resolveImport(importPath) {
  if (importPath.startsWith("@openzeppelin/")) {
    const resolved = require.resolve(importPath, { paths: [solidityRoot] });
    return { contents: readFileSync(resolved, "utf8") };
  }
  return { error: `Unable to resolve ${importPath}` };
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/TokenVesting.sol": {
        content: readFileSync(path.join(solidityRoot, "contracts", "TokenVesting.sol"), "utf8"),
      },
      "test/MockERC20.sol": { content: mockTokenSource },
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
    vesting: output.contracts["contracts/TokenVesting.sol"].TokenVesting,
    token: output.contracts["test/MockERC20.sol"].MockERC20,
  };
}

function artifact(contract) {
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  };
}

async function deploy(contract, signer, args = []) {
  const { abi, bytecode } = artifact(contract);
  const factory = new ethers.ContractFactory(abi, bytecode, signer);
  const deployed = await factory.deploy(...args);
  await deployed.waitForDeployment();
  return deployed;
}

function expectedVested(totalAllocation, elapsed, duration) {
  const wholeTokenRate = totalAllocation / duration;
  const remainder = totalAllocation % duration;
  return wholeTokenRate * elapsed + remainder * elapsed / duration;
}

async function setTimestamp(provider, timestamp) {
  const latest = await provider.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
  const delta = Number(timestamp - BigInt(latest.timestamp));
  if (delta > 0) {
    await provider.request({ method: "evm_increaseTime", params: [delta] });
  }
  await provider.request({ method: "evm_mine", params: [] });
}

const contracts = compileContracts();
const ganacheProvider = ganache.provider({
  chain: { chainId: 31_337 },
  logging: { quiet: true },
  wallet: { deterministic: true },
});
const provider = new ethers.BrowserProvider(ganacheProvider);
const owner = await provider.getSigner(0);
const beneficiary = await provider.getSigner(1);
const beneficiaryAddress = await beneficiary.getAddress();
const ownerAddress = await owner.getAddress();

const token = await deploy(contracts.token, owner, [
  "Vesting Token",
  "VEST",
  ethers.parseEther("1000000000000"),
]);
const tokenAddress = await token.getAddress();
const baseTime = BigInt((await provider.getBlock("latest")).timestamp + 1000);
const longDuration = 126_144_000n;
const postLongBaseTime = baseTime + longDuration / 2n + 10_000n;

async function deployVesting(totalAllocation, start, cliffDuration, duration, fund = true) {
  const vesting = await deploy(contracts.vesting, owner, [
    tokenAddress,
    beneficiaryAddress,
    totalAllocation,
    start,
    cliffDuration,
    duration,
  ]);

  if (fund) {
    await (await token.transfer(await vesting.getAddress(), totalAllocation)).wait();
  }

  return vesting;
}

{
  await assert.rejects(async () => {
    await deployVesting(100n, baseTime, 101n, 100n, false);
  });

  await assert.rejects(async () => {
    await deployVesting(100n, ethers.MaxUint256, 0n, 1n, false);
  });
}

{
  const hugeAllocation = ethers.parseEther("1000000000");
  const duration = longDuration;
  const elapsed = duration / 2n;
  const vesting = await deployVesting(hugeAllocation, baseTime, 0n, duration, false);
  await setTimestamp(ganacheProvider, baseTime + elapsed);
  assert.equal(await vesting.vestedAmount(), expectedVested(hugeAllocation, elapsed, duration));
}

{
  const duration = 1000n;
  const elapsed = 500n;
  const hugeAllocation = ethers.MaxUint256 - 1000n;
  const vesting = await deployVesting(hugeAllocation, postLongBaseTime, 0n, duration, false);
  await setTimestamp(ganacheProvider, postLongBaseTime + elapsed);
  assert.equal(await vesting.vestedAmount(), expectedVested(hugeAllocation, elapsed, duration));
}

{
  const total = ethers.parseEther("1000");
  const vesting = await deployVesting(total, postLongBaseTime + 20_000n, 500n, 2000n);
  await setTimestamp(ganacheProvider, postLongBaseTime + 20_100n);

  const ownerBefore = await token.balanceOf(ownerAddress);
  const beneficiaryBefore = await token.balanceOf(beneficiaryAddress);
  await (await vesting.revoke()).wait();

  assert.equal(await token.balanceOf(beneficiaryAddress), beneficiaryBefore);
  assert.equal(await token.balanceOf(ownerAddress), ownerBefore + total);
  assert.equal(await token.balanceOf(await vesting.getAddress()), 0n);
}

{
  const total = 1000n;
  const start = postLongBaseTime + 30_000n;
  const vesting = await deployVesting(total, start, 0n, 10n);
  await setTimestamp(ganacheProvider, start + 4n);
  await (await vesting.connect(beneficiary).claim()).wait();
  assert.equal(await token.balanceOf(beneficiaryAddress), 400n);

  await setTimestamp(ganacheProvider, start + 6n);
  const ownerBefore = await token.balanceOf(ownerAddress);
  await (await vesting.revoke()).wait();

  assert.equal(await token.balanceOf(beneficiaryAddress), 600n);
  assert.equal(await token.balanceOf(ownerAddress), ownerBefore + 400n);
  assert.equal(await token.balanceOf(await vesting.getAddress()), 0n);
}

{
  const total = 1000n;
  const start = postLongBaseTime + 40_000n;
  const duration = 6n;
  const vesting = await deployVesting(total, start, 0n, duration);
  await setTimestamp(ganacheProvider, start + 5n);
  assert.equal(await vesting.vestedAmount(), 833n);

  await setTimestamp(ganacheProvider, start + duration);
  assert.equal(await vesting.vestedAmount(), total);
  await (await vesting.connect(beneficiary).claim()).wait();
  assert.equal(await token.balanceOf(await vesting.getAddress()), 0n);
}

console.log("TokenVesting overflow, revoke, completion, and remainder tests passed");
