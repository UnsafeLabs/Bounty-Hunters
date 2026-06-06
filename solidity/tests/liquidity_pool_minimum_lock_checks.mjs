import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "contracts", "LiquidityPool.sol");
const source = fs.readFileSync(sourcePath, "utf8");
const removeLiquidityBody = source.slice(
  source.indexOf("function removeLiquidity"),
  source.indexOf("function sync"),
);

function assertIncludes(text, message) {
  assert.ok(source.includes(text), message);
}

function assertMatches(pattern, message) {
  assert.match(source, pattern, message);
}

function assertNotMatches(pattern, message, text = source) {
  assert.doesNotMatch(text, pattern, message);
}

function assertBefore(first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `${first} not found`);
  assert.notEqual(secondIndex, -1, `${second} not found`);
  assert.ok(firstIndex < secondIndex, message);
}

assertIncludes("uint256 public constant MINIMUM_LIQUIDITY = 1000;", "minimum liquidity constant must remain 1000");
assertMatches(/if \(supply == 0\)[\s\S]*rootK - MINIMUM_LIQUIDITY/, "first deposit must subtract locked liquidity");
assertIncludes("_mint(address(0), MINIMUM_LIQUIDITY);", "minimum liquidity must be permanently locked");
assertMatches(
  /uint256 lpFromA = amountA \* supply \/ reserveA;[\s\S]*uint256 lpFromB = amountB \* supply \/ reserveB;/,
  "subsequent deposits must use internal reserves",
);
assertMatches(
  /amountA = lpTokens \* reserveA \/ supply;[\s\S]*amountB = lpTokens \* reserveB \/ supply;/,
  "removal must use internal reserves instead of live balances",
);
assertNotMatches(
  /balanceOf\(address\(this\)\)/,
  "direct token donations must not affect removeLiquidity pricing",
  removeLiquidityBody,
);
assertMatches(/function sync\(\) external[\s\S]*tokenA\.balanceOf\(address\(this\)\)[\s\S]*emit Sync/, "sync must recover reserves from actual balances");
assertBefore("reserveA -= amountA;", "tokenA.transfer(msg.sender, amountA)", "reserves must update before external transfers");

console.log("LiquidityPool minimum-liquidity checks passed.");
