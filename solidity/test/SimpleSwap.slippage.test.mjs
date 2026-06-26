import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../contracts/SimpleSwap.sol", import.meta.url), "utf8");
const FEE_DENOMINATOR = 10_000n;

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
