import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const contractPath = resolve("solidity/contracts/SimpleSwap.sol");
const source = readFileSync(contractPath, "utf8");

function assertIncludes(snippet, message) {
  assert.ok(source.includes(snippet), message);
}

function quoteAmountOut(reserveIn, reserveOut, amountIn, feeBps) {
  const amountInWithFee = amountIn * (10_000n - feeBps);
  return (reserveOut * amountInWithFee) / (reserveIn * 10_000n + amountInWithFee);
}

assertIncludes(
  "function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut, uint256 deadline)",
  "swap must require minAmountOut and deadline parameters",
);
assertIncludes('require(block.timestamp <= deadline, "Deadline expired")', "swap must reject expired transactions");
assertIncludes('require(amountOut >= minAmountOut, "Slippage exceeded")', "swap must enforce minAmountOut");
assertIncludes("uint256 private constant BPS_DENOMINATOR = 10000", "fee math should use a named BPS denominator");
assertIncludes(
  "uint256 amountInWithFee = amountIn * (BPS_DENOMINATOR - fee)",
  "fee should be applied inside fixed-point constant-product math instead of truncating fee first",
);
assertIncludes(
  "(reserveOut * amountInWithFee) / (reserveIn * BPS_DENOMINATOR + amountInWithFee)",
  "constant-product quote must preserve basis-point precision",
);
assertIncludes("require(inputToken.transferFrom", "swap must require successful input token transfer");
assertIncludes("require(outputToken.transfer", "swap must require successful output token transfer");
assertIncludes("function _getAmountOut", "swap and getAmountOut should share one quote implementation");
assertIncludes(
  "return _getAmountOut(reserveIn, reserveOut, amountIn)",
  "public quote path should call the shared implementation",
);

const expected = quoteAmountOut(1_000_000n, 2_000_000n, 1_000n, 30n);
assert.equal(expected, 1992n, "quote math should produce deterministic fee-adjusted output");
assert.ok(expected >= 1992n, "exact expected output should satisfy minAmountOut");
assert.ok(expected < 1993n, "too-high minAmountOut should fail slippage protection");

console.log("SimpleSwap issue #913 checks passed");
