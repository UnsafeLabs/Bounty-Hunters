const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "contracts", "SimpleSwap.sol"),
  "utf8",
);

assert(
  source.includes(
    "function swap(\n        address tokenIn,\n        uint256 amountIn,\n        uint256 minAmountOut,\n        uint256 deadline",
  ),
  "swap must accept minAmountOut and deadline parameters",
);

assert(
  source.includes('require(block.timestamp <= deadline, "Deadline expired");'),
  "swap must reject expired transactions",
);

assert(
  source.includes('require(amountOut >= minAmountOut, "Slippage exceeded");'),
  "swap must enforce caller-provided slippage protection",
);

assert(
  source.includes("amountIn * (FEE_DENOMINATOR - fee)") &&
    source.includes("reserveIn * FEE_DENOMINATOR + amountInWithFee"),
  "output math must apply basis-point fees without early fee truncation",
);

assert(
  !source.includes("uint256 feeAmount = amountIn * fee / 10000"),
  "old early-truncating fee calculation must not be used",
);

console.log("SimpleSwap source checks passed");
