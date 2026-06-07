import assert from "node:assert/strict";

const MAX_STALENESS = 3600n;

function makeRound({ roundId = 10n, price = 100n, updatedAt, answeredInRound = roundId }) {
  return { roundId, price, updatedAt, answeredInRound };
}

class PriceOracleModel {
  constructor(primary, fallback = null, now = 10_000n) {
    this.primary = primary;
    this.fallback = fallback;
    this.now = now;
    this.maxStaleness = MAX_STALENESS;
    this.events = [];
  }

  setFallbackFeed(fallback) {
    this.fallback = fallback;
  }

  setMaxStaleness(maxStaleness) {
    if (maxStaleness <= 0n) throw new Error("Invalid staleness");
    this.maxStaleness = maxStaleness;
  }

  getLatestPrice() {
    const primary = this.primary();
    this.validateRound(primary);

    if (this.isStale(primary.updatedAt)) {
      this.events.push({ name: "StalePrice", updatedAt: primary.updatedAt });
      if (!this.fallback) throw new Error("Fallback not set");

      const fallback = this.fallback();
      this.validateRound(fallback);
      if (this.isStale(fallback.updatedAt)) throw new Error("Stale price");

      this.events.push({ name: "PriceQueried", price: fallback.price, updatedAt: fallback.updatedAt });
      return fallback.price;
    }

    this.events.push({ name: "PriceQueried", price: primary.price, updatedAt: primary.updatedAt });
    return primary.price;
  }

  validateRound(round) {
    if (round.answeredInRound < round.roundId) throw new Error("Incomplete round");
    if (round.price <= 0n) throw new Error("Invalid price");
    if (round.updatedAt <= 0n || round.updatedAt > this.now) throw new Error("Invalid timestamp");
  }

  isStale(updatedAt) {
    return this.now - updatedAt >= this.maxStaleness;
  }
}

{
  const oracle = new PriceOracleModel(() => makeRound({ price: 123n, updatedAt: 9_500n }));
  assert.equal(oracle.getLatestPrice(), 123n);
  assert.equal(oracle.events[0].name, "PriceQueried");
}

{
  const oracle = new PriceOracleModel(
    () => makeRound({ price: 100n, updatedAt: 6_000n }),
    () => makeRound({ price: 101n, updatedAt: 9_900n }),
  );

  assert.equal(oracle.getLatestPrice(), 101n);
  assert.deepEqual(oracle.events.map((event) => event.name), ["StalePrice", "PriceQueried"]);
}

assert.throws(
  () => new PriceOracleModel(() => makeRound({ price: 0n, updatedAt: 9_900n })).getLatestPrice(),
  /Invalid price/,
);

assert.throws(
  () =>
    new PriceOracleModel(() =>
      makeRound({ roundId: 10n, price: 100n, updatedAt: 9_900n, answeredInRound: 9n }),
    ).getLatestPrice(),
  /Incomplete round/,
);

assert.throws(
  () =>
    new PriceOracleModel(
      () => makeRound({ price: 100n, updatedAt: 6_000n }),
      () => makeRound({ price: 101n, updatedAt: 5_999n }),
    ).getLatestPrice(),
  /Stale price/,
);

{
  const oracle = new PriceOracleModel(() => makeRound({ price: 100n, updatedAt: 9_000n }));
  assert.equal(oracle.getLatestPrice(), 100n);
  oracle.setMaxStaleness(500n);
  oracle.setFallbackFeed(() => makeRound({ price: 99n, updatedAt: 9_900n }));
  assert.equal(oracle.getLatestPrice(), 99n);
}

console.log("PriceOracle validation and fallback checks passed");
