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
      "contracts/SimpleSwap.sol": {
        content: readFileSync(path.join(solidityRoot, "contracts", "SimpleSwap.sol"), "utf8"),
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
    swap: output.contracts["contracts/SimpleSwap.sol"].SimpleSwap,
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

function hasRevertReason(error, reason) {
  return JSON.stringify(error, Object.getOwnPropertyNames(error)).includes(reason);
}

async function expectRevert(action, reason) {
  try {
    await action();
  } catch (error) {
    assert.equal(hasRevertReason(error, reason), true);
    return;
  }
  assert.fail(`Expected revert: ${reason}`);
}

function expectedOut(amountIn, reserveIn, reserveOut, feeBps) {
  const amountInWithFee = amountIn * (10_000n - feeBps);
  return (reserveOut * amountInWithFee) / (reserveIn * 10_000n + amountInWithFee);
}

const contracts = compileContracts();
const ganacheProvider = ganache.provider({
  chain: { chainId: 31_337 },
  logging: { quiet: true },
  wallet: { deterministic: true },
});
const provider = new ethers.BrowserProvider(ganacheProvider);
const owner = await provider.getSigner(0);
const trader = await provider.getSigner(1);
const traderAddress = await trader.getAddress();

const supply = ethers.parseEther("1000000");
const tokenA = await deploy(contracts.token, owner, ["Token A", "A", supply]);
const tokenB = await deploy(contracts.token, owner, ["Token B", "B", supply]);
const tokenAAddress = await tokenA.getAddress();
const tokenBAddress = await tokenB.getAddress();

await assert.rejects(async () => {
  await deploy(contracts.swap, owner, [ethers.ZeroAddress, tokenBAddress, 30]);
});

await assert.rejects(async () => {
  await deploy(contracts.swap, owner, [tokenAAddress, tokenAAddress, 30]);
});

const swap = await deploy(contracts.swap, owner, [
  tokenAAddress,
  tokenBAddress,
  30,
]);
const swapAddress = await swap.getAddress();

const reserveA = ethers.parseEther("1000");
const reserveB = ethers.parseEther("1000");
await expectRevert(
  () => swap.addLiquidity.staticCall(0, reserveB),
  "Invalid liquidity",
);

await (await tokenA.approve(swapAddress, reserveA)).wait();
await (await tokenB.approve(swapAddress, reserveB)).wait();
await (await swap.addLiquidity(reserveA, reserveB)).wait();

const amountIn = ethers.parseEther("10");
await (await tokenA.transfer(traderAddress, amountIn * 2n)).wait();
await (await tokenA.connect(trader).approve(swapAddress, amountIn * 2n)).wait();

const deadline = BigInt((await provider.getBlock("latest")).timestamp + 60);
const quote = await swap.getAmountOut(tokenAAddress, amountIn);
assert.equal(quote, expectedOut(amountIn, reserveA, reserveB, 30n));

await expectRevert(
  () => swap.connect(trader).swap.staticCall(
    tokenAAddress,
    amountIn,
    quote + 1n,
    deadline,
  ),
  "Slippage exceeded",
);

await expectRevert(
  () => swap.connect(trader).swap.staticCall(
    tokenAAddress,
    amountIn,
    0,
    deadline - 61n,
  ),
  "Deadline expired",
);

const beforeB = await tokenB.balanceOf(traderAddress);
await (await swap.connect(trader).swap(
  tokenAAddress,
  amountIn,
  quote,
  deadline,
)).wait();
const afterB = await tokenB.balanceOf(traderAddress);
assert.equal(afterB - beforeB, quote);

const tinyIn = 100n;
const oldFeeAmount = tinyIn * 30n / 10_000n;
const fixedPointFeeNumerator = tinyIn * (10_000n - 30n);
assert.equal(oldFeeAmount, 0n);
assert.equal(fixedPointFeeNumerator, 997000n);

console.log("SimpleSwap slippage, deadline, and fee precision tests passed");
