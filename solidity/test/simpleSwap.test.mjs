import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requireFromTest = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const solidityRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(solidityRoot, "..");
const fallbackModules = process.env.SOLIDITY_TEST_NODE_MODULES;

function requirePackage(name) {
  try {
    return requireFromTest(name);
  } catch (error) {
    if (!fallbackModules) {
      throw error;
    }
    const requireFromFallback = createRequire(path.join(fallbackModules, "package.json"));
    return requireFromFallback(name);
  }
}

const { ethers } = requirePackage("ethers");
const ganachePackage = requirePackage("ganache");
const ganache = ganachePackage.default ?? ganachePackage;
const solc = requirePackage("solc");

const mockTokenSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}
`;

function resolveImport(importPath) {
  if (importPath.startsWith("@openzeppelin/")) {
    const resolved = requireFromTest.resolve(importPath, { paths: [solidityRoot, fallbackModules].filter(Boolean) });
    return { contents: readFileSync(resolved, "utf8") };
  }

  try {
    return { contents: readFileSync(path.join(repoRoot, importPath), "utf8") };
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
    simpleSwap: output.contracts["solidity/contracts/SimpleSwap.sol"].SimpleSwap,
    mockToken: output.contracts["test/MockToken.sol"].MockToken,
  };
}

async function deploy(compiled, signer, args = []) {
  const factory = new ethers.ContractFactory(
    compiled.abi,
    `0x${compiled.evm.bytecode.object}`,
    signer,
  );
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function expectRevert(action, message) {
  await assert.rejects(
    action,
    (error) => [
      error.shortMessage,
      error.message,
      error.info?.error?.data?.reason,
      error.info?.error?.message,
    ].some((value) => String(value ?? "").includes(message)),
  );
}

function feeRoundedUp(amountIn, feeBps) {
  if (feeBps === 0n) {
    return 0n;
  }
  return (amountIn * feeBps + 9999n) / 10000n;
}

function expectedAmountOut(amountIn, reserveIn, reserveOut, feeBps) {
  const afterFee = amountIn - feeRoundedUp(amountIn, feeBps);
  return (reserveOut * afterFee) / (reserveIn + afterFee);
}

const compiled = compileContracts();
const ganacheProvider = ganache.provider({
  chain: { chainId: 31337 },
  logging: { quiet: true },
  wallet: { deterministic: true },
});
const provider = new ethers.BrowserProvider(ganacheProvider);
const owner = await provider.getSigner(0);
const trader = await provider.getSigner(1);
const ownerAddress = await owner.getAddress();
const traderAddress = await trader.getAddress();

const tokenA = await deploy(compiled.mockToken, owner, ["Token A", "TKA"]);
const tokenB = await deploy(compiled.mockToken, owner, ["Token B", "TKB"]);
const swap = await deploy(compiled.simpleSwap, owner, [
  await tokenA.getAddress(),
  await tokenB.getAddress(),
  30,
]);

const reserveA = ethers.parseEther("1000");
const reserveB = ethers.parseEther("500");
await (await tokenA.mint(ownerAddress, reserveA)).wait();
await (await tokenB.mint(ownerAddress, reserveB)).wait();
await (await tokenA.approve(await swap.getAddress(), reserveA)).wait();
await (await tokenB.approve(await swap.getAddress(), reserveB)).wait();
await (await swap.addLiquidity(reserveA, reserveB)).wait();

const amountIn = ethers.parseEther("10");
await (await tokenA.mint(traderAddress, amountIn * 2n)).wait();
await (await tokenA.connect(trader).approve(await swap.getAddress(), amountIn * 2n)).wait();

const quote = await swap.getAmountOut(await tokenA.getAddress(), amountIn);
assert.equal(quote, expectedAmountOut(amountIn, reserveA, reserveB, 30n));

const latestBlock = await provider.getBlock("latest");
const liveDeadline = BigInt(latestBlock.timestamp + 120);

await expectRevert(
  async () => {
    const tx = await swap.connect(trader).swap(await tokenA.getAddress(), amountIn, quote + 1n, liveDeadline);
    await tx.wait();
  },
  "Slippage exceeded",
);

await expectRevert(
  async () => {
    const tx = await swap.connect(trader).swap(await tokenA.getAddress(), amountIn, 0, liveDeadline - 121n);
    await tx.wait();
  },
  "Deadline expired",
);

await (await swap.connect(trader).swap(await tokenA.getAddress(), amountIn, quote, liveDeadline)).wait();
assert.equal(await tokenB.balanceOf(traderAddress), quote);

await expectRevert(
  async () => swap.getAmountOut(await tokenA.getAddress(), 1n),
  "Amount too small after fee",
);

assert.equal(feeRoundedUp(34n, 30n), 1n);

console.log("SimpleSwap slippage, deadline, and fee precision tests passed");
