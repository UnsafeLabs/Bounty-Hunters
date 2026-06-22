const { expect } = require("chai");
const { ethers } = require("hardhat");

// Mock Chainlink aggregator for testing
async function deployMockAggregator(decimals = 8) {
  const MockAggregator = await ethers.getContractFactory("MockAggregatorV3");
  const agg = await MockAggregator.deploy(decimals);
  await agg.waitForDeployment();
  return agg;
}

describe("PriceOracle", function () {
  let primaryAgg, fallbackAgg, oracle;

  beforeEach(async function () {
    primaryAgg = await deployMockAggregator(8);
    fallbackAgg = await deployMockAggregator(8);
    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    oracle = await PriceOracle.deploy(await primaryAgg.getAddress(), await fallbackAgg.getAddress());
    await oracle.waitForDeployment();
  });

  it("returns valid price from primary oracle", async function () {
    await primaryAgg.setLatestRoundData(1, 300000000000, 1000, Math.floor(Date.now() / 1000), 1);
    const price = await oracle.getLatestPrice.staticCall();
    expect(price).to.equal(300000000000);
  });

  it("reverts on zero or negative price", async function () {
    await primaryAgg.setLatestRoundData(1, 0, 1000, Math.floor(Date.now() / 1000), 1);
    await expect(oracle.getLatestPrice()).to.be.revertedWithCustomError(oracle, "InvalidPrice");
  });

  it("reverts on incomplete round", async function () {
    await primaryAgg.setLatestRoundData(5, 300000000000, 1000, Math.floor(Date.now() / 1000), 3);
    await expect(oracle.getLatestPrice()).to.be.revertedWithCustomError(oracle, "IncompleteRound");
  });

  it("falls back to secondary oracle when primary is stale", async function () {
    const staleTs = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
    await primaryAgg.setLatestRoundData(1, 300000000000, 1000, staleTs, 1);
    await fallbackAgg.setLatestRoundData(1, 310000000000, 1000, Math.floor(Date.now() / 1000), 1);
    const price = await oracle.getLatestPrice.staticCall();
    expect(price).to.equal(310000000000);
  });

  it("reverts when both oracles are stale", async function () {
    const staleTs = Math.floor(Date.now() / 1000) - 7200;
    await primaryAgg.setLatestRoundData(1, 300000000000, 1000, staleTs, 1);
    await fallbackAgg.setLatestRoundData(1, 310000000000, 1000, staleTs, 1);
    await expect(oracle.getLatestPrice()).to.be.revertedWithCustomError(oracle, "StalePriceBothOracles");
  });

  it("emits StalePrice event when falling back", async function () {
    const staleTs = Math.floor(Date.now() / 1000) - 7200;
    await primaryAgg.setLatestRoundData(1, 300000000000, 1000, staleTs, 1);
    await fallbackAgg.setLatestRoundData(1, 310000000000, 1000, Math.floor(Date.now() / 1000), 1);
    await expect(oracle.getLatestPrice())
      .to.emit(oracle, "StalePrice")
      .withArgs(await primaryAgg.getAddress(), staleTs);
  });

  it("owner can update MAX_STALENESS", async function () {
    await oracle.setMaxStaleness(7200);
    expect(await oracle.MAX_STALENESS()).to.equal(7200);
  });
});
