import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("PriceOracle", function () {
  let primaryFeed, fallbackFeed, priceOracle;
  beforeEach(async function () {

    const MockAggregator = await ethers.getContractFactory("MockAggregator");
    primaryFeed = await MockAggregator.deploy();
    await primaryFeed.deployed();

    fallbackFeed = await MockAggregator.deploy();
    await fallbackFeed.deployed();

    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    priceOracle = await PriceOracle.deploy(primaryFeed.address, fallbackFeed.address);
    await priceOracle.deployed();
  });

  it("should return valid price from primary oracle", async function () {
    const latestBlock = await ethers.provider.getBlock("latest");
    const now = latestBlock.timestamp;

    // roundId, answer, startedAt, updatedAt, answeredInRound
    await primaryFeed.setMockData(1, 1000, now - 100, now - 10, 1);

    const price = await priceOracle.callStatic.getLatestPrice();
    expect(price).to.equal(1000);
  });

  it("should revert if primary returns zero or negative price", async function () {
    const latestBlock = await ethers.provider.getBlock("latest");
    const now = latestBlock.timestamp;

    await primaryFeed.setMockData(1, 0, now - 100, now - 10, 1);
    await expect(priceOracle.callStatic.getLatestPrice()).to.be.revertedWith("Invalid price");

    await primaryFeed.setMockData(1, -10, now - 100, now - 10, 1);
    await expect(priceOracle.callStatic.getLatestPrice()).to.be.revertedWith("Invalid price");
  });

  it("should revert on incomplete round from primary", async function () {
    const latestBlock = await ethers.provider.getBlock("latest");
    const now = latestBlock.timestamp;

    // answeredInRound (0) < roundId (1)
    await primaryFeed.setMockData(1, 1000, now - 100, now - 10, 0);
    await expect(priceOracle.callStatic.getLatestPrice()).to.be.revertedWith("Incomplete round");
  });

  it("should fallback to secondary oracle if primary is stale and emit StalePrice", async function () {
    const latestBlock = await ethers.provider.getBlock("latest");
    const now = latestBlock.timestamp;

    const staleTime = now - 3601;
    await primaryFeed.setMockData(1, 1000, staleTime - 100, staleTime, 1);
    
    // secondary is valid
    await fallbackFeed.setMockData(1, 2000, now - 100, now - 10, 1);

    const price = await priceOracle.callStatic.getLatestPrice();
    expect(price).to.equal(2000);

    const tx = await priceOracle.getLatestPriceAndEmit();
    await expect(tx).to.emit(priceOracle, "StalePrice").withArgs(staleTime);
  });

  it("should revert if both oracles are stale", async function () {
    const latestBlock = await ethers.provider.getBlock("latest");
    const now = latestBlock.timestamp;

    const staleTime = now - 3601;
    await primaryFeed.setMockData(1, 1000, staleTime - 100, staleTime, 1);
    await fallbackFeed.setMockData(1, 2000, staleTime - 100, staleTime, 1);

    await expect(priceOracle.callStatic.getLatestPrice()).to.be.revertedWith("Stale price");
  });
});
