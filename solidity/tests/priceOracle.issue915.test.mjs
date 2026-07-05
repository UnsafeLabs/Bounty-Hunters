import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "../contracts/PriceOracle.sol"), "utf8");

function expectSource(pattern, message) {
  assert.match(source, pattern, message);
}

expectSource(
  /AggregatorV3Interface\s+public\s+fallbackFeed\s*;/,
  "PriceOracle must expose a configured fallback feed",
);

expectSource(
  /event\s+StalePrice\s*\([^)]*uint256\s+updatedAt[^)]*\)\s*;/,
  "PriceOracle must emit StalePrice with the primary feed timestamp",
);

expectSource(
  /function\s+getLatestPrice\s*\(\)\s+external\s+returns\s*\(\s*int256\s*\)/,
  "getLatestPrice must be able to emit when it falls back",
);

expectSource(
  /require\s*\(\s*(?:price|feedPrice)\s*>\s*0\s*,\s*"Invalid price"\s*\)\s*;/,
  "oracle reads must reject zero or negative prices",
);

expectSource(
  /require\s*\(\s*answeredInRound\s*>=\s*roundId\s*,\s*"Incomplete round"\s*\)\s*;/,
  "oracle reads must reject incomplete Chainlink rounds",
);

expectSource(
  /require\s*\(\s*block\.timestamp\s*-\s*updatedAt\s*<\s*MAX_STALENESS\s*,\s*"Stale price"\s*\)\s*;/,
  "freshness validation must use the owner-configurable MAX_STALENESS window",
);

expectSource(
  /emit\s+StalePrice\s*\([^;]*updatedAt[^;]*\)\s*;/,
  "stale primary reads must emit StalePrice before using fallback",
);

expectSource(
  /function\s+setFallbackFeed\s*\(\s*address\s+_fallbackFeed\s*\)\s+external/,
  "owner must be able to configure the fallback feed",
);

expectSource(
  /_readFeed\s*\(\s*fallbackFeed\s*\)/,
  "stale primary reads must query the fallback feed through the shared validation path",
);

function quoteStaleness(now, updatedAt, maxStaleness) {
  return now - updatedAt < maxStaleness;
}

assert.equal(quoteStaleness(10_000n, 9_000n, 3_600n), true);
assert.equal(quoteStaleness(10_000n, 6_399n, 3_600n), false);

console.log("PriceOracle issue #915 checks passed");
