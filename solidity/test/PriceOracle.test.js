const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("PriceOracle", function () {
  let primary;
  let fallbackFeed;
  let oracle;
  let owner;
  let other;

  async function setFreshPrice(feed, price = 1000n) {
    const block = await ethers.provider.getBlock("latest");
    await feed.setRoundData(1, price, block.timestamp, block.timestamp, 1);
  }

  async function setStalePrice(feed, price = 1000n) {
    const block = await ethers.provider.getBlock("latest");
    await feed.setRoundData(1, price, block.timestamp - 7200, block.timestamp - 7200, 1);
  }

  beforeEach(async function () {
    [owner, other] = await ethers.getSigners();
    const MockAggregatorV3 = await ethers.getContractFactory("MockAggregatorV3");
    primary = await MockAggregatorV3.deploy(8);
    fallbackFeed = await MockAggregatorV3.deploy(8);

    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    oracle = await PriceOracle.deploy(await primary.getAddress(), await fallbackFeed.getAddress());
  });

  it("returns a valid fresh primary price", async function () {
    await setFreshPrice(primary, 1234n);
    await setFreshPrice(fallbackFeed, 5678n);

    await expect(oracle.getLatestPrice())
      .to.emit(oracle, "PriceQueried")
      .withArgs(1234n, anyValue);
  });

  it("falls back and emits StalePrice when the primary price is stale", async function () {
    await setStalePrice(primary, 1234n);
    await setFreshPrice(fallbackFeed, 5678n);

    const [, , , staleUpdatedAt] = await primary.latestRoundData();
    await expect(oracle.getLatestPrice())
      .to.emit(oracle, "StalePrice")
      .withArgs(await primary.getAddress(), staleUpdatedAt, anyValue)
      .and.to.emit(oracle, "PriceQueried")
      .withArgs(5678n, anyValue);
  });

  it("reverts for zero or negative primary prices", async function () {
    const block = await ethers.provider.getBlock("latest");
    await primary.setRoundData(1, 0, block.timestamp, block.timestamp, 1);
    await setFreshPrice(fallbackFeed);

    await expect(oracle.getLatestPrice()).to.be.revertedWith("Invalid price");

    await primary.setRoundData(1, -1, block.timestamp, block.timestamp, 1);
    await expect(oracle.getLatestPrice()).to.be.revertedWith("Invalid price");
  });

  it("rejects incomplete rounds", async function () {
    const block = await ethers.provider.getBlock("latest");
    await primary.setRoundData(2, 1000, block.timestamp, block.timestamp, 1);
    await setFreshPrice(fallbackFeed);

    await expect(oracle.getLatestPrice()).to.be.revertedWith("Incomplete round");
  });

  it("reverts if both primary and fallback prices are stale", async function () {
    await setStalePrice(primary, 1234n);
    await setStalePrice(fallbackFeed, 5678n);

    await expect(oracle.getLatestPrice()).to.be.revertedWith("Stale fallback price");
  });

  it("lets only the owner configure max staleness", async function () {
    await expect(oracle.connect(other).setMaxStaleness(1800)).to.be.revertedWith("Not owner");
    await expect(oracle.setMaxStaleness(1800))
      .to.emit(oracle, "MaxStalenessUpdated")
      .withArgs(1800);
    expect(await oracle.MAX_STALENESS()).to.equal(1800);
  });

  it("lets only the owner update the fallback feed", async function () {
    const MockAggregatorV3 = await ethers.getContractFactory("MockAggregatorV3");
    const newFallback = await MockAggregatorV3.deploy(8);

    await expect(oracle.connect(other).setFallbackFeed(await newFallback.getAddress())).to.be.revertedWith("Not owner");
    await expect(oracle.setFallbackFeed(await newFallback.getAddress()))
      .to.emit(oracle, "FallbackFeedUpdated")
      .withArgs(await newFallback.getAddress());
    expect(await oracle.fallbackFeed()).to.equal(await newFallback.getAddress());
  });
});
