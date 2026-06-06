import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "contracts", "SimpleSwap.sol");
const source = fs.readFileSync(sourcePath, "utf8");

function assertIncludes(text, message) {
  assert.ok(source.includes(text), message);
}

function assertMatches(pattern, message) {
  assert.match(source, pattern, message);
}

assertMatches(
  /function swap\([\s\S]*uint256 minAmountOut,[\s\S]*uint256 deadline[\s\S]*\) external returns/,
  "swap must accept minAmountOut and deadline",
);
assertIncludes('require(block.timestamp <= deadline, "Transaction expired");', "swap must reject stale transactions");
assertIncludes('require(amountOut >= minAmountOut, "Slippage exceeded");', "swap must enforce minimum output");
assertIncludes("uint256 private constant BPS_DENOMINATOR = 10_000;", "basis point denominator must be explicit");
assertIncludes("uint256 private constant FEE_PRECISION = 1e18;", "fee math must use fixed-point precision");
assertMatches(
  /uint256 feeMultiplier = \(BPS_DENOMINATOR - fee\) \* FEE_PRECISION \/ BPS_DENOMINATOR;/,
  "fee multiplier must be calculated with fixed-point math",
);
assertMatches(
  /uint256 amountInAfterFee = amountIn \* feeMultiplier \/ FEE_PRECISION;/,
  "fee must be applied after fixed-point scaling",
);
assertIncludes('require(inputToken.transferFrom(msg.sender, address(this), amountIn), "Input transfer failed");', "input transfer result must be checked");
assertIncludes('require(outputToken.transfer(msg.sender, amountOut), "Output transfer failed");', "output transfer result must be checked");
assertMatches(/function getAmountOut[\s\S]*return _getAmountOut\(amountIn, reserveIn, reserveOut\);/, "quote path must share swap math");

console.log("SimpleSwap slippage checks passed.");
