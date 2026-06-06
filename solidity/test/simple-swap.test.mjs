import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import ganache from "ganache";
import solc from "solc";
import { ethers } from "ethers";

const require = createRequire(import.meta.url);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(testDir, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(projectDir, relativePath), "utf8");
}

function findImports(importPath) {
  try {
    const resolvedPath = importPath.startsWith("@")
      ? require.resolve(importPath, { paths: [projectDir] })
      : path.join(projectDir, importPath);
    return { contents: fs.readFileSync(resolvedPath, "utf8") };
  } catch (error) {
    return { error: `Unable to resolve ${importPath}: ${error.message}` };
  }
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/SimpleSwap.sol": { content: readSource("contracts/SimpleSwap.sol") },
      "test/MockERC20.sol": { content: readSource("test/MockERC20.sol") },
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

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = output.errors?.filter((entry) => entry.severity === "error") ?? [];
  assert.equal(errors.length, 0, errors.map((entry) => entry.formattedMessage).join("\n"));
  return output.contracts;
}

function getArtifact(contracts, name) {
  for (const contractGroup of Object.values(contracts)) {
    if (contractGroup[name]) {
      return contractGroup[name];
    }
  }
  throw new Error(`Missing compiled artifact for ${name}`);
}

async function deploy(contracts, signer, name, args = []) {
  const artifact = getArtifact(contracts, name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function latestTimestamp(provider) {
  return BigInt((await provider.getBlock("latest")).timestamp);
}

async function expectRevert(action, pattern) {
  try {
    await action();
  } catch (error) {
    assert.match(String(error), pattern);
    return;
  }
  assert.fail("Expected transaction to revert");
}

const contracts = compileContracts();

async function setup({ liquidityA = 1_000_000n, liquidityB = 1_000_000n } = {}) {
  const provider = new ethers.BrowserProvider(
    ganache.provider({
      logging: { quiet: true },
      wallet: { totalAccounts: 4, defaultBalance: 1000 },
    }),
  );

  const [owner, trader] = await Promise.all([0, 1].map((index) => provider.getSigner(index)));
  const ownerAddress = await owner.getAddress();
  const traderAddress = await trader.getAddress();
  const tokenA = await deploy(contracts, owner, "MockERC20", ["Token A", "TKA"]);
  const tokenB = await deploy(contracts, owner, "MockERC20", ["Token B", "TKB"]);
  const swap = await deploy(contracts, owner, "SimpleSwap", [
    await tokenA.getAddress(),
    await tokenB.getAddress(),
    30n,
  ]);

  const traderBalance = 20_000n;
  await (await tokenA.mint(ownerAddress, liquidityA)).wait();
  await (await tokenB.mint(ownerAddress, liquidityB)).wait();
  await (await tokenA.mint(traderAddress, traderBalance)).wait();
  await (await tokenA.approve(await swap.getAddress(), liquidityA)).wait();
  await (await tokenB.approve(await swap.getAddress(), liquidityB)).wait();
  await (await tokenA.connect(trader).approve(await swap.getAddress(), traderBalance)).wait();
  await (await swap.addLiquidity(liquidityA, liquidityB)).wait();

  return {
    provider,
    trader,
    tokenA,
    tokenB,
    swap,
    tokenAAddress: await tokenA.getAddress(),
  };
}

{
  const { provider, trader, tokenA, tokenB, swap, tokenAAddress } = await setup();
  const amountIn = 10_000n;
  const quote = await swap.getAmountOut(tokenAAddress, amountIn);
  const deadline = (await latestTimestamp(provider)) + 3_600n;
  const tokenBBefore = await tokenB.balanceOf(await trader.getAddress());

  await (await swap.connect(trader).swap(tokenAAddress, amountIn, quote, deadline)).wait();

  const tokenBAfter = await tokenB.balanceOf(await trader.getAddress());
  assert.equal(tokenBAfter - tokenBBefore, quote);
}

{
  const { provider, trader, swap, tokenAAddress } = await setup();
  const amountIn = 10_000n;
  const quote = await swap.getAmountOut(tokenAAddress, amountIn);
  const deadline = (await latestTimestamp(provider)) + 3_600n;

  await expectRevert(
    () => swap.connect(trader).swap.staticCall(tokenAAddress, amountIn, quote + 1n, deadline),
    /Slippage exceeded/,
  );
}

{
  const { provider, trader, swap, tokenAAddress } = await setup();
  const amountIn = 10_000n;
  const quote = await swap.getAmountOut(tokenAAddress, amountIn);
  const expiredDeadline = (await latestTimestamp(provider)) - 1n;

  await expectRevert(
    () => swap.connect(trader).swap.staticCall(tokenAAddress, amountIn, quote, expiredDeadline),
    /Transaction expired/,
  );
}

{
  const liquidityA = 1_000n;
  const liquidityB = 1_000_000n;
  const { swap, tokenAAddress } = await setup({ liquidityA, liquidityB });
  const amountIn = 100n;
  const amountInWithFee = amountIn * 9_970n;
  const expectedFixedPointQuote = (liquidityB * amountInWithFee) / (liquidityA * 10_000n + amountInWithFee);
  const truncatedFeeQuote = (liquidityB * amountIn) / (liquidityA + amountIn);

  assert.equal(await swap.getAmountOut(tokenAAddress, amountIn), expectedFixedPointQuote);
  assert(expectedFixedPointQuote < truncatedFeeQuote);
}

console.log("SimpleSwap slippage, deadline, and fee precision regressions passed");
