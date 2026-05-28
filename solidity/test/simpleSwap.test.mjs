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

const mockTokenSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
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
      "solidity/contracts/SimpleSwap.sol": {
        content: readFileSync(path.join(solidityRoot, "contracts", "SimpleSwap.sol"), "utf8"),
      },
      "test/MockToken.sol": {
        content: mockTokenSource,
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
    swap: output.contracts["solidity/contracts/SimpleSwap.sol"].SimpleSwap,
    token: output.contracts["test/MockToken.sol"].MockToken,
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

function expectedOut(amountIn, reserveIn, reserveOut, feeBps) {
  const feeAmount = feeBps === 0n ? 0n : ((amountIn * feeBps - 1n) / 10_000n) + 1n;
  const amountInAfterFee = amountIn - feeAmount;
  return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
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

const tokenA = await deploy(contracts.token, owner, ["Token A", "TKA"]);
const tokenB = await deploy(contracts.token, owner, ["Token B", "TKB"]);
const swap = await deploy(contracts.swap, owner, [
  await tokenA.getAddress(),
  await tokenB.getAddress(),
  30,
]);

const reserveA = ethers.parseEther("1000");
const reserveB = ethers.parseEther("1000");
await (await tokenA.mint(await owner.getAddress(), reserveA)).wait();
await (await tokenB.mint(await owner.getAddress(), reserveB)).wait();
await (await tokenA.approve(await swap.getAddress(), reserveA)).wait();
await (await tokenB.approve(await swap.getAddress(), reserveB)).wait();
await (await swap.addLiquidity(reserveA, reserveB)).wait();

const amountIn = ethers.parseEther("10");
await (await tokenA.mint(traderAddress, amountIn * 2n)).wait();
await (await tokenA.connect(trader).approve(await swap.getAddress(), amountIn * 2n)).wait();
const deadline = BigInt((await provider.getBlock("latest")).timestamp + 60);
const quote = await swap.getAmountOut(await tokenA.getAddress(), amountIn);
assert.equal(quote, expectedOut(amountIn, reserveA, reserveB, 30n));

await expectRevert(async () => {
  const tx = await swap.connect(trader).swap(
    await tokenA.getAddress(),
    amountIn,
    quote + 1n,
    deadline,
  );
  await tx.wait();
});

await expectRevert(async () => {
  const tx = await swap.connect(trader).swap(
    await tokenA.getAddress(),
    amountIn,
    0,
    deadline - 61n,
  );
  await tx.wait();
});

await (await swap.connect(trader).swap(
  await tokenA.getAddress(),
  amountIn,
  quote,
  deadline,
)).wait();
assert.equal(await tokenB.balanceOf(traderAddress), quote);

const tinyIn = 100n;
const tinyQuote = await swap.getAmountOut(await tokenA.getAddress(), tinyIn);
assert.equal(tinyQuote, expectedOut(tinyIn, reserveA + amountIn, reserveB - quote, 30n));
assert.equal(tinyQuote > 0n, true);

console.log("SimpleSwap slippage and deadline tests passed");
