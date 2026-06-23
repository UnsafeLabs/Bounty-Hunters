const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PriceOracle", function () {
  let oracle;
  let primaryFeed;
  let fallbackFeed;
  let owner;
  let user;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    const MockAggregator = await ethers.getContractFactory("MockV3Aggregator");
    primaryFeed = await MockAggregator.deploy(8, 200000000000n); // 2000 USD with 8 decimals
    fallbackFeed = await MockAggregator.deploy(8, 201000000000n); // 2010 USD

    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    oracle = await PriceOracle.deploy(primaryFeed.target);
    await oracle.setFallbackOracle(fallbackFeed.target);
  });

  it("Should return primary price if data is valid and fresh", async function () {
    const price = await oracle.getLatestPrice();
    expect(price).to.equal(200000000000n);
  });

  it("Should return fallback price if primary feed reverts", async function () {
    await primaryFeed.setShouldRevert(true);
    const price = await oracle.getLatestPrice();
    expect(price).to.equal(201000000000n);
  });

  it("Should return fallback price if primary price is stale", async function () {
    // Set primary feed updated at to 2 hours ago
    const twoHoursAgo = (await ethers.provider.getBlock("latest")).timestamp - 7200;
    await primaryFeed.updateRoundData(2, 200000000000n, twoHoursAgo, 2);

    const price = await oracle.getLatestPrice();
    expect(price).to.equal(201000000000n);
  });

  it("Should return fallback price if primary price is invalid (negative or zero)", async function () {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await primaryFeed.updateRoundData(2, 0n, now, 2);

    const price = await oracle.getLatestPrice();
    expect(price).to.equal(201000000000n);
  });
});
