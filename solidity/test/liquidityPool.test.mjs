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

const poolSource = fs.readFileSync(
  path.join(solidityDir, "contracts", "LiquidityPool.sol"),
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
      "LiquidityPool.sol": { content: poolSource },
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

async function setup() {
  const contracts = compile();
  const provider = new ethers.BrowserProvider(
    ganache.provider({ logging: { quiet: true } })
  );
  const [owner, providerAccount, donor] = await Promise.all([
    provider.getSigner(0),
    provider.getSigner(1),
    provider.getSigner(2),
  ]);

  const tokenArtifact = contracts["MockToken.sol"].MockToken;
  const poolArtifact = contracts["LiquidityPool.sol"].LiquidityPool;
  const Token = new ethers.ContractFactory(
    tokenArtifact.abi,
    tokenArtifact.evm.bytecode.object,
    owner
  );
  const Pool = new ethers.ContractFactory(
    poolArtifact.abi,
    poolArtifact.evm.bytecode.object,
    owner
  );

  const tokenA = await deploy(Token, owner, "Token A", "A");
  const tokenB = await deploy(Token, owner, "Token B", "B");
  const pool = await deploy(Pool, owner, await tokenA.getAddress(), await tokenB.getAddress());
  const amount = ethers.parseEther("100000");

  for (const signer of [providerAccount, donor]) {
    const address = await signer.getAddress();
    await (await tokenA.mint(address, amount)).wait();
    await (await tokenB.mint(address, amount)).wait();
    await (await tokenA.connect(signer).approve(await pool.getAddress(), amount)).wait();
    await (await tokenB.connect(signer).approve(await pool.getAddress(), amount)).wait();
  }

  return { providerAccount, donor, tokenA, tokenB, pool };
}

async function run() {
  {
    const { providerAccount, pool } = await setup();
    await expectRejects(
      pool.connect(providerAccount).addLiquidity.staticCall(1000, 1000),
      "Insufficient initial liquidity"
    );

    const amount = ethers.parseEther("1000");
    await (await pool.connect(providerAccount).addLiquidity(amount, amount)).wait();

    assert.equal(await pool.balanceOf(ethers.ZeroAddress), 1000n);
    assert.equal(await pool.lockedLiquidity(), 1000n);
    assert.equal(await pool.totalSupply(), amount);
    assert.equal(await pool.balanceOf(await providerAccount.getAddress()), amount - 1000n);
  }

  {
    const { providerAccount, donor, tokenA, tokenB, pool } = await setup();
    const poolAddress = await pool.getAddress();
    const amount = ethers.parseEther("1000");
    await (await pool.connect(providerAccount).addLiquidity(amount, amount)).wait();

    const lpToBurn = (await pool.balanceOf(await providerAccount.getAddress())) / 2n;
    const beforeDonation = await pool.connect(providerAccount).removeLiquidity.staticCall(lpToBurn);

    await (await tokenA.connect(donor).transfer(poolAddress, ethers.parseEther("5000"))).wait();
    assert.equal(await pool.reserveA(), amount);
    assert.equal(await tokenA.balanceOf(poolAddress), ethers.parseEther("6000"));

    const afterDonation = await pool.connect(providerAccount).removeLiquidity.staticCall(lpToBurn);
    assert.equal(afterDonation[0], beforeDonation[0]);
    assert.equal(afterDonation[1], beforeDonation[1]);

    await (await pool.connect(providerAccount).removeLiquidity(lpToBurn)).wait();
    assert.equal(await pool.reserveA(), amount - beforeDonation[0]);
    assert.equal(await pool.reserveB(), amount - beforeDonation[1]);
  }

  {
    const { providerAccount, donor, tokenA, tokenB, pool } = await setup();
    const poolAddress = await pool.getAddress();
    const amount = ethers.parseEther("1000");
    await (await pool.connect(providerAccount).addLiquidity(amount, amount)).wait();

    await (await tokenA.connect(donor).transfer(poolAddress, ethers.parseEther("250"))).wait();
    await (await tokenB.connect(donor).transfer(poolAddress, ethers.parseEther("125"))).wait();
    await (await pool.sync()).wait();

    assert.equal(await pool.reserveA(), await tokenA.balanceOf(poolAddress));
    assert.equal(await pool.reserveB(), await tokenB.balanceOf(poolAddress));
  }

  {
    const { providerAccount, donor, pool } = await setup();
    const amount = ethers.parseEther("1000");
    await (await pool.connect(providerAccount).addLiquidity(amount, amount)).wait();
    const supplyBefore = await pool.totalSupply();

    await (await pool.connect(donor).addLiquidity(ethers.parseEther("100"), ethers.parseEther("100"))).wait();
    assert.equal(await pool.totalSupply(), supplyBefore + ethers.parseEther("100"));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
