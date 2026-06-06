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
      "contracts/LiquidityPool.sol": { content: readSource("contracts/LiquidityPool.sol") },
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

async function expectRevert(action) {
  try {
    await action();
  } catch (error) {
    assert.match(String(error), /CALL_EXCEPTION|revert|transaction execution reverted/);
    return;
  }
  assert.fail("Expected transaction to revert");
}

const contracts = compileContracts();
const provider = new ethers.BrowserProvider(
  ganache.provider({
    logging: { quiet: true },
    wallet: { totalAccounts: 4, defaultBalance: 1000 },
  }),
);

const [owner, providerTwo, attacker] = await Promise.all(
  [0, 1, 2].map((index) => provider.getSigner(index)),
);
const ownerAddress = await owner.getAddress();
const providerTwoAddress = await providerTwo.getAddress();
const attackerAddress = await attacker.getAddress();

const tokenA = await deploy(contracts, owner, "MockERC20", ["Token A", "TKA"]);
const tokenB = await deploy(contracts, owner, "MockERC20", ["Token B", "TKB"]);
const pool = await deploy(contracts, owner, "LiquidityPool", [
  await tokenA.getAddress(),
  await tokenB.getAddress(),
]);

const MINIMUM_LIQUIDITY = 1_000n;
const INITIAL = 1_000_000n;
const SECOND_DEPOSIT = 500_000n;
const DONATION = 900_000n;

for (const [account, amount] of [
  [ownerAddress, INITIAL],
  [providerTwoAddress, SECOND_DEPOSIT],
  [attackerAddress, DONATION + 100n],
]) {
  await (await tokenA.mint(account, amount)).wait();
  await (await tokenB.mint(account, amount)).wait();
}

await (await tokenA.connect(owner).approve(await pool.getAddress(), INITIAL)).wait();
await (await tokenB.connect(owner).approve(await pool.getAddress(), INITIAL)).wait();
await (await pool.connect(owner).addLiquidity(INITIAL, INITIAL)).wait();

assert.equal(await pool.balanceOf(ethers.ZeroAddress), MINIMUM_LIQUIDITY);
assert.equal(await pool.balanceOf(ownerAddress), INITIAL - MINIMUM_LIQUIDITY);
assert.equal(await pool.totalSupply(), INITIAL);
assert.equal(await pool.reserveA(), INITIAL);
assert.equal(await pool.reserveB(), INITIAL);

await (await tokenA.connect(providerTwo).approve(await pool.getAddress(), SECOND_DEPOSIT)).wait();
await (await tokenB.connect(providerTwo).approve(await pool.getAddress(), SECOND_DEPOSIT)).wait();
await (await pool.connect(providerTwo).addLiquidity(SECOND_DEPOSIT, SECOND_DEPOSIT)).wait();

assert.equal(await pool.balanceOf(providerTwoAddress), SECOND_DEPOSIT);
assert.equal(await pool.totalSupply(), INITIAL + SECOND_DEPOSIT);
assert.equal(await pool.reserveA(), INITIAL + SECOND_DEPOSIT);
assert.equal(await pool.reserveB(), INITIAL + SECOND_DEPOSIT);

await (await tokenA.connect(attacker).transfer(await pool.getAddress(), DONATION)).wait();
assert.equal(await pool.reserveA(), INITIAL + SECOND_DEPOSIT);

const providerTwoTokenABefore = await tokenA.balanceOf(providerTwoAddress);
const providerTwoTokenBBefore = await tokenB.balanceOf(providerTwoAddress);
await (await pool.connect(providerTwo).removeLiquidity(SECOND_DEPOSIT)).wait();

assert.equal((await tokenA.balanceOf(providerTwoAddress)) - providerTwoTokenABefore, SECOND_DEPOSIT);
assert.equal((await tokenB.balanceOf(providerTwoAddress)) - providerTwoTokenBBefore, SECOND_DEPOSIT);
assert.equal(await pool.reserveA(), INITIAL);
assert.equal(await pool.reserveB(), INITIAL);

await (await pool.sync()).wait();
assert.equal(await pool.reserveA(), INITIAL + DONATION);
assert.equal(await pool.reserveB(), INITIAL);

const tinyPool = await deploy(contracts, owner, "LiquidityPool", [
  await tokenA.getAddress(),
  await tokenB.getAddress(),
]);
await (await tokenA.connect(attacker).approve(await tinyPool.getAddress(), 100n)).wait();
await (await tokenB.connect(attacker).approve(await tinyPool.getAddress(), 100n)).wait();
await expectRevert(
  () => tinyPool.connect(attacker).addLiquidity(100n, 100n),
);
assert.equal(await tinyPool.totalSupply(), 0n);

console.log("LiquidityPool first-depositor and donation attack regressions passed");
