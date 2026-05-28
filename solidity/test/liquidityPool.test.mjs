import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ethers } from "ethers";
import ganache from "ganache";
import solc from "solc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const ONE_MILLION = 1_000_000n;
const MINIMUM_LIQUIDITY = 1000n;

const mockErc20Source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
`;

function findImports(importPath) {
  const candidates = [
    path.join(projectRoot, importPath),
    path.join(projectRoot, "node_modules", importPath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }

  return { error: `File not found: ${importPath}` };
}

function compileContracts() {
  const liquidityPoolPath = path.join(projectRoot, "contracts", "LiquidityPool.sol");
  const input = {
    language: "Solidity",
    sources: {
      "LiquidityPool.sol": { content: fs.readFileSync(liquidityPoolPath, "utf8") },
      "MockERC20.sol": { content: mockErc20Source },
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
  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.deepEqual(errors, []);

  return {
    LiquidityPool: output.contracts["LiquidityPool.sol"].LiquidityPool,
    MockERC20: output.contracts["MockERC20.sol"].MockERC20,
  };
}

async function deploy(factory, signer, ...args) {
  const contract = await new ethers.ContractFactory(
    factory.abi,
    factory.evm.bytecode.object,
    signer,
  ).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function setup() {
  const provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true } }));
  const [owner, alice, bob, attacker] = await Promise.all(
    [0, 1, 2, 3].map((index) => provider.getSigner(index)),
  );
  const compiled = compileContracts();
  const tokenA = await deploy(compiled.MockERC20, owner, "Token A", "TKNA");
  const tokenB = await deploy(compiled.MockERC20, owner, "Token B", "TKNB");
  const pool = await deploy(compiled.LiquidityPool, owner, await tokenA.getAddress(), await tokenB.getAddress());

  for (const signer of [alice, bob, attacker]) {
    await tokenA.mint(await signer.getAddress(), 20_000_000n);
    await tokenB.mint(await signer.getAddress(), 20_000_000n);
    await tokenA.connect(signer).approve(await pool.getAddress(), ethers.MaxUint256);
    await tokenB.connect(signer).approve(await pool.getAddress(), ethers.MaxUint256);
  }

  return { provider, owner, alice, bob, attacker, tokenA, tokenB, pool };
}

async function expectRevert(promise, reason) {
  await assert.rejects(promise, (error) => {
    assert.match(error.shortMessage ?? error.message, /revert|missing revert data/i);
    if (reason) {
      assert.match(error.info?.error?.message ?? error.message, new RegExp(reason));
    }
    return true;
  });
}

describe("LiquidityPool", function () {
  this.timeout(30_000);

  it("locks minimum liquidity at address(0) and mints the first depositor the remainder", async () => {
    const { alice, pool } = await setup();

    await pool.connect(alice).addLiquidity(ONE_MILLION, ONE_MILLION);

    assert.equal(await pool.MINIMUM_LIQUIDITY(), MINIMUM_LIQUIDITY);
    assert.equal(await pool.totalSupply(), ONE_MILLION);
    assert.equal(await pool.balanceOf(ethers.ZeroAddress), MINIMUM_LIQUIDITY);
    assert.equal(await pool.balanceOf(await alice.getAddress()), ONE_MILLION - MINIMUM_LIQUIDITY);
    assert.equal(await pool.reserveA(), ONE_MILLION);
    assert.equal(await pool.reserveB(), ONE_MILLION);
  });

  it("rejects a first deposit whose geometric mean cannot exceed the lock", async () => {
    const { alice, pool } = await setup();

    await expectRevert(pool.connect(alice).addLiquidity(MINIMUM_LIQUIDITY, MINIMUM_LIQUIDITY), "Insufficient liquidity");
  });

  it("mints subsequent liquidity from internal reserves and total supply", async () => {
    const { alice, bob, pool } = await setup();

    await pool.connect(alice).addLiquidity(ONE_MILLION, ONE_MILLION);
    await pool.connect(bob).addLiquidity(500_000n, 250_000n);

    assert.equal(await pool.balanceOf(await bob.getAddress()), 250_000n);
    assert.equal(await pool.totalSupply(), 1_250_000n);
    assert.equal(await pool.reserveA(), 1_500_000n);
    assert.equal(await pool.reserveB(), 1_250_000n);
  });

  it("isolates direct token transfers from LP pricing until sync is called", async () => {
    const { alice, bob, attacker, tokenA, tokenB, pool } = await setup();
    const poolAddress = await pool.getAddress();
    const aliceAddress = await alice.getAddress();

    await pool.connect(alice).addLiquidity(ONE_MILLION, ONE_MILLION);
    await tokenA.connect(attacker).transfer(poolAddress, 9_000_000n);

    const aliceABefore = await tokenA.balanceOf(aliceAddress);
    const aliceBBefore = await tokenB.balanceOf(aliceAddress);
    await pool.connect(alice).removeLiquidity(100_000n);
    const aliceAAfter = await tokenA.balanceOf(aliceAddress);
    const aliceBAfter = await tokenB.balanceOf(aliceAddress);

    assert.equal(aliceAAfter - aliceABefore, 100_000n);
    assert.equal(aliceBAfter - aliceBBefore, 100_000n);
    assert.equal(await pool.reserveA(), 900_000n);
    assert.equal(await pool.reserveB(), 900_000n);

    await pool.connect(bob).addLiquidity(90_000n, 90_000n);
    assert.equal(await pool.balanceOf(await bob.getAddress()), 90_000n);
    assert.equal(await pool.reserveA(), 990_000n);
    assert.equal(await pool.reserveB(), 990_000n);
  });

  it("syncs internal reserves to actual balances and emits Sync", async () => {
    const { alice, bob, attacker, tokenA, tokenB, pool } = await setup();
    const poolAddress = await pool.getAddress();

    await pool.connect(alice).addLiquidity(ONE_MILLION, ONE_MILLION);
    await tokenA.connect(attacker).transfer(poolAddress, 500_000n);
    await tokenB.connect(attacker).transfer(poolAddress, 250_000n);

    const receipt = await (await pool.sync()).wait();
    const parsedLogs = receipt.logs
      .map((log) => {
        try {
          return pool.interface.parseLog(log);
        } catch {
          return undefined;
        }
      })
      .filter(Boolean);

    assert.equal(await pool.reserveA(), 1_500_000n);
    assert.equal(await pool.reserveB(), 1_250_000n);
    assert.ok(
      parsedLogs.some((log) => log.name === "Sync" && log.args.reserveA === 1_500_000n && log.args.reserveB === 1_250_000n),
    );

    await pool.connect(bob).addLiquidity(100_000n, 100_000n);
    assert.equal(await pool.balanceOf(await bob.getAddress()), 66_666n);
  });

  it("supports normal add and remove liquidity flows using internal reserves", async () => {
    const { alice, bob, tokenA, tokenB, pool } = await setup();
    const bobAddress = await bob.getAddress();

    await pool.connect(alice).addLiquidity(ONE_MILLION, ONE_MILLION);
    await pool.connect(bob).addLiquidity(500_000n, 500_000n);

    const bobABefore = await tokenA.balanceOf(bobAddress);
    const bobBBefore = await tokenB.balanceOf(bobAddress);
    await pool.connect(bob).removeLiquidity(500_000n);
    const bobAAfter = await tokenA.balanceOf(bobAddress);
    const bobBAfter = await tokenB.balanceOf(bobAddress);

    assert.equal(bobAAfter - bobABefore, 500_000n);
    assert.equal(bobBAfter - bobBBefore, 500_000n);
    assert.equal(await pool.balanceOf(bobAddress), 0n);
    assert.equal(await pool.totalSupply(), ONE_MILLION);
    assert.equal(await pool.reserveA(), ONE_MILLION);
    assert.equal(await pool.reserveB(), ONE_MILLION);
  });
});
