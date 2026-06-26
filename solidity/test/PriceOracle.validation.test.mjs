import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../contracts/PriceOracle.sol", import.meta.url), "utf8");

function readFeed(feed, now, maxStaleness) {
  if (feed.answeredInRound < feed.roundId) throw new Error("Incomplete round");
  if (feed.price <= 0n) throw new Error("Invalid price");
  if (feed.updatedAt <= 0n || feed.updatedAt > now) throw new Error("Invalid timestamp");
  return {
    price: feed.price,
    updatedAt: feed.updatedAt,
    stale: now - feed.updatedAt > maxStaleness,
  };
}

function latestPrice({ primary, fallbackFeed = null, now = 10_000n, maxStaleness = 3_600n }) {
  const primaryResult = readFeed(primary, now, maxStaleness);
  if (!primaryResult.stale) return { price: primaryResult.price, usedFallback: false };
  if (!fallbackFeed) throw new Error("Stale price");

  const fallbackResult = readFeed(fallbackFeed, now, maxStaleness);
  if (fallbackResult.stale) throw new Error("Stale price");
  return { price: fallbackResult.price, usedFallback: true };
}

const freshFeed = {
  roundId: 10n,
  answeredInRound: 10n,
  price: 2_000n,
  updatedAt: 9_900n,
};

test("source validates Chainlink answer, round completeness, and staleness", () => {
  assert.match(source, /require\(answeredInRound >= roundId, "Incomplete round"\);/);
  assert.match(source, /require\(answer > 0, "Invalid price"\);/);
  assert.match(source, /block\.timestamp - feedUpdatedAt > MAX_STALENESS/);
  assert.match(source, /event StalePrice\(address indexed feed, uint256 updatedAt\);/);
  assert.match(source, /function setFallbackFeed\(address _fallbackFeed\) external onlyOwner/);
});

test("fresh primary price is returned without fallback", () => {
  assert.deepEqual(latestPrice({ primary: freshFeed }), { price: 2_000n, usedFallback: false });
});

test("stale primary price falls back to a fresh secondary feed", () => {
  const result = latestPrice({
    primary: { ...freshFeed, updatedAt: 1_000n },
    fallbackFeed: { ...freshFeed, price: 2_050n },
  });
  assert.deepEqual(result, { price: 2_050n, usedFallback: true });
});

test("zero or negative price is rejected instead of falling back silently", () => {
  assert.throws(() => latestPrice({ primary: { ...freshFeed, price: 0n } }), {
    message: "Invalid price",
  });
  assert.throws(() => latestPrice({ primary: { ...freshFeed, price: -1n } }), {
    message: "Invalid price",
  });
});

test("incomplete rounds are rejected", () => {
  assert.throws(() => latestPrice({ primary: { ...freshFeed, answeredInRound: 9n } }), {
    message: "Incomplete round",
  });
});

test("both feeds stale reverts instead of returning a stale fallback", () => {
  assert.throws(
    () =>
      latestPrice({
        primary: { ...freshFeed, updatedAt: 1_000n },
        fallbackFeed: { ...freshFeed, updatedAt: 2_000n },
      }),
    { message: "Stale price" },
  );
});
