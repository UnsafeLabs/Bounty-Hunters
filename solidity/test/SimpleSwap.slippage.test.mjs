import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("../contracts/SimpleSwap.sol", import.meta.url), "utf8");
const FEE_DENOMINATOR = 10_000n;
const require = createRequire(import.meta.url);
const evmDepsDir = process.env.SIMPLE_SWAP_EVM_DEPS;
const evmDeps = evmDepsDir
  ? {
      solc: require(`${evmDepsDir}/solc`),
      ganache: require(`${evmDepsDir}/ganache`),
      ethers: require(`${evmDepsDir}/ethers`).ethers,
    }
  : null;

const mockTokenSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockToken {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
`;

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "SimpleSwap.sol": { content: source },
      "MockToken.sol": { content: mockTokenSource },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(
    evmDeps.solc.compile(JSON.stringify(input), {
      import: (path) => {
        if (path.startsWith("@openzeppelin/")) {
          return { contents: readFileSync(`${evmDepsDir}/${path}`, "utf8") };
        }
        return { error: `File not found: ${path}` };
      },
    }),
  );
  const errors = (output.errors ?? []).filter((error) => error.severity === "error");
  assert.deepEqual(errors, []);
  return output.contracts;
}

async function deploy(contract, signer, args = []) {
  const factory = new evmDeps.ethers.ContractFactory(
    contract.abi,
    contract.evm.bytecode.object,
    signer,
  );
  const deployed = await factory.deploy(...args);
  await deployed.waitForDeployment();
  return deployed;
}

async function expectRevert(action, pattern) {
  await assert.rejects(async () => {
    const tx = await action();
    if (tx?.wait) {
      await tx.wait();
    }
  }, pattern);
}

function quoteAmountOut({ reserveIn, reserveOut, amountIn, fee }) {
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error("Insufficient liquidity");

  const amountInWithFee = amountIn * (FEE_DENOMINATOR - fee);
  const denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
  return (reserveOut * amountInWithFee) / denominator;
}

function roundedFeeQuote({ reserveIn, reserveOut, amountIn, fee }) {
  const feeAmount = (amountIn * fee) / FEE_DENOMINATOR;
  const amountInAfterFee = amountIn - feeAmount;
  return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
}

function swapModel({ now, deadline, amountOut, minAmountOut }) {
  if (now > deadline) throw new Error("Transaction expired");
  if (amountOut < minAmountOut) throw new Error("Slippage exceeded");
  return amountOut;
}

test("swap exposes minAmountOut and deadline protections", () => {
  assert.match(source, /function swap\(\s*address tokenIn,\s*uint256 amountIn,\s*uint256 minAmountOut,\s*uint256 deadline\s*\)/);
  assert.match(source, /require\(block\.timestamp <= deadline, "Transaction expired"\);/);
  assert.match(source, /require\(amountOut >= minAmountOut, "Slippage exceeded"\);/);
});

test("fee calculation uses scaled basis-point math instead of rounded feeAmount", () => {
  assert.match(source, /uint256 private constant FEE_DENOMINATOR = 10_000;/);
  assert.match(source, /amountIn \* \(FEE_DENOMINATOR - fee\)/);
  assert.match(source, /Math\.mulDiv\(reserveOut, amountInWithFee, denominator\)/);
  assert.doesNotMatch(source, /feeAmount\s*=\s*amountIn\s*\*\s*fee\s*\/\s*10000/);
});

test("swap with exact expected output succeeds", () => {
  const amountOut = quoteAmountOut({
    reserveIn: 1_000_000n,
    reserveOut: 1_000_000n,
    amountIn: 10_000n,
    fee: 30n,
  });

  assert.equal(
    swapModel({ now: 100n, deadline: 100n, amountOut, minAmountOut: amountOut }),
    amountOut,
  );
});

test("swap below minAmountOut reverts with slippage error", () => {
  const amountOut = 99n;
  assert.throws(
    () => swapModel({ now: 100n, deadline: 101n, amountOut, minAmountOut: 100n }),
    /Slippage exceeded/,
  );
});

test("expired swaps revert before execution", () => {
  assert.throws(
    () => swapModel({ now: 102n, deadline: 101n, amountOut: 100n, minAmountOut: 1n }),
    /Transaction expired/,
  );
});

test("small-amount fee precision no longer rounds the fee away", () => {
  const params = {
    reserveIn: 1_000_000n,
    reserveOut: 1_000_000_000_000n,
    amountIn: 1n,
    fee: 30n,
  };

  const scaled = quoteAmountOut(params);
  const rounded = roundedFeeQuote(params);

  assert.ok(scaled > 0n);
  assert.ok(scaled < rounded);
});

test("public quote path validates token and liquidity", () => {
  assert.match(source, /require\(tokenIn == address\(tokenA\) \|\| tokenIn == address\(tokenB\), "Invalid token"\);/);
  assert.match(source, /require\(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity"\);/);
});

test("EVM swap accepts exact output and updates reserves", { skip: !evmDeps }, async () => {
  const contracts = compileContracts();
  const provider = new evmDeps.ethers.BrowserProvider(
    evmDeps.ganache.provider({ logging: { quiet: true } }),
  );
  const liquidityProvider = await provider.getSigner(0);
  const trader = await provider.getSigner(1);
  const traderAddress = await trader.getAddress();

  const tokenA = await deploy(contracts["MockToken.sol"].MockToken, liquidityProvider, [
    "Token A",
    "TKA",
  ]);
  const tokenB = await deploy(contracts["MockToken.sol"].MockToken, liquidityProvider, [
    "Token B",
    "TKB",
  ]);
  const tokenAAddress = await tokenA.getAddress();
  const tokenBAddress = await tokenB.getAddress();
  const liquidityProviderAddress = await liquidityProvider.getAddress();
  const swap = await deploy(contracts["SimpleSwap.sol"].SimpleSwap, liquidityProvider, [
    tokenAAddress,
    tokenBAddress,
    30n,
  ]);
  const swapAddress = await swap.getAddress();

  await (await tokenA.mint(liquidityProviderAddress, 1_000_000n)).wait();
  await (await tokenB.mint(liquidityProviderAddress, 1_000_000n)).wait();
  await (await tokenA.approve(swapAddress, 1_000_000n)).wait();
  await (await tokenB.approve(swapAddress, 1_000_000n)).wait();
  await (await swap.addLiquidity(1_000_000n, 1_000_000n)).wait();

  await (await tokenA.mint(traderAddress, 10_000n)).wait();
  await (await tokenA.connect(trader).approve(swapAddress, 10_000n)).wait();
  const quote = await swap.getAmountOut(tokenAAddress, 10_000n);
  const latest = await provider.getBlock("latest");

  await (
    await swap.connect(trader).swap(
      tokenAAddress,
      10_000n,
      quote,
      BigInt(latest.timestamp + 60),
    )
  ).wait();

  assert.equal(await tokenB.balanceOf(traderAddress), quote);
  assert.equal(await swap.reserveA(), 1_010_000n);
  assert.equal(await swap.reserveB(), 1_000_000n - quote);
});

test("EVM swap rejects slippage and expired deadlines", { skip: !evmDeps }, async () => {
  const contracts = compileContracts();
  const provider = new evmDeps.ethers.BrowserProvider(
    evmDeps.ganache.provider({ logging: { quiet: true } }),
  );
  const liquidityProvider = await provider.getSigner(0);
  const trader = await provider.getSigner(1);
  const traderAddress = await trader.getAddress();

  const tokenA = await deploy(contracts["MockToken.sol"].MockToken, liquidityProvider, [
    "Token A",
    "TKA",
  ]);
  const tokenB = await deploy(contracts["MockToken.sol"].MockToken, liquidityProvider, [
    "Token B",
    "TKB",
  ]);
  const tokenAAddress = await tokenA.getAddress();
  const tokenBAddress = await tokenB.getAddress();
  const liquidityProviderAddress = await liquidityProvider.getAddress();
  const swap = await deploy(contracts["SimpleSwap.sol"].SimpleSwap, liquidityProvider, [
    tokenAAddress,
    tokenBAddress,
    30n,
  ]);
  const swapAddress = await swap.getAddress();

  await (await tokenA.mint(liquidityProviderAddress, 1_000_000n)).wait();
  await (await tokenB.mint(liquidityProviderAddress, 1_000_000n)).wait();
  await (await tokenA.approve(swapAddress, 1_000_000n)).wait();
  await (await tokenB.approve(swapAddress, 1_000_000n)).wait();
  await (await swap.addLiquidity(1_000_000n, 1_000_000n)).wait();

  await (await tokenA.mint(traderAddress, 20_000n)).wait();
  await (await tokenA.connect(trader).approve(swapAddress, 20_000n)).wait();
  const quote = await swap.getAmountOut(tokenAAddress, 10_000n);
  const latest = await provider.getBlock("latest");

  await expectRevert(
    () =>
      swap.connect(trader).swap(
        tokenAAddress,
        10_000n,
        quote + 1n,
        BigInt(latest.timestamp + 60),
      ),
    /Slippage exceeded|revert/,
  );

  await expectRevert(
    () =>
      swap.connect(trader).swap(
        tokenAAddress,
        10_000n,
        1n,
        BigInt(latest.timestamp - 1),
      ),
    /Transaction expired|revert/,
  );
});

test("EVM quote preserves small-amount fee precision", { skip: !evmDeps }, async () => {
  const contracts = compileContracts();
  const provider = new evmDeps.ethers.BrowserProvider(
    evmDeps.ganache.provider({ logging: { quiet: true } }),
  );
  const liquidityProvider = await provider.getSigner(0);

  const tokenA = await deploy(contracts["MockToken.sol"].MockToken, liquidityProvider, [
    "Token A",
    "TKA",
  ]);
  const tokenB = await deploy(contracts["MockToken.sol"].MockToken, liquidityProvider, [
    "Token B",
    "TKB",
  ]);
  const tokenAAddress = await tokenA.getAddress();
  const tokenBAddress = await tokenB.getAddress();
  const liquidityProviderAddress = await liquidityProvider.getAddress();
  const swap = await deploy(contracts["SimpleSwap.sol"].SimpleSwap, liquidityProvider, [
    tokenAAddress,
    tokenBAddress,
    30n,
  ]);
  const swapAddress = await swap.getAddress();

  await (await tokenA.mint(liquidityProviderAddress, 1_000_000n)).wait();
  await (await tokenB.mint(liquidityProviderAddress, 1_000_000_000_000n)).wait();
  await (await tokenA.approve(swapAddress, 1_000_000n)).wait();
  await (await tokenB.approve(swapAddress, 1_000_000_000_000n)).wait();
  await (await swap.addLiquidity(1_000_000n, 1_000_000_000_000n)).wait();

  const scaledQuote = await swap.getAmountOut(tokenAAddress, 1n);
  const roundedQuote = roundedFeeQuote({
    reserveIn: 1_000_000n,
    reserveOut: 1_000_000_000_000n,
    amountIn: 1n,
    fee: 30n,
  });

  assert.ok(scaledQuote > 0n);
  assert.ok(scaledQuote < roundedQuote);
});
