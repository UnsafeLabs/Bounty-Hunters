const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PriceOracle", function () {
  let oracle;
  let primaryFeed;
  let fallbackFeed;
  let owner;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();

    const MockFeed = await ethers.getContractFactory("MockV3Aggregator");
    // roundId, answer, startedAt, updatedAt, answeredInRound
    primaryFeed = await MockFeed.deploy(18, 2000e8);
    fallbackFeed = await MockFeed.deploy(18, 2100e8);

    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    oracle = await PriceOracle.deploy(primaryFeed.address, fallbackFeed.address);
  });

  it("should return primary price when valid", async function () {
    const price = await oracle.getLatestPrice();
    expect(price).to.equal(2000e8);
  });

  it("should fallback to secondary when primary is stale", async function () {
    // Set primary to 2 hours ago
    const staleTime = (await ethers.provider.getBlock("latest")).timestamp - 7200;
    await primaryFeed.updateRoundData(1, 2000e8, staleTime, staleTime);
    
    const price = await oracle.getLatestPrice();
    expect(price).to.equal(2100e8);
  });

  it("should revert if primary is invalid and fallback is stale", async function () {
    const staleTime = (await ethers.provider.getBlock("latest")).timestamp - 7200;
    await primaryFeed.updateRoundData(1, 0, staleTime, staleTime);
    await fallbackFeed.updateRoundData(1, 2100e8, staleTime, staleTime);
    
    await expect(oracle.getLatestPrice()).to.be.revertedWith("Fallback price stale");
  });

  it("should revert on negative price", async function () {
    await primaryFeed.updateRoundData(1, -100, 0, 0);
    await fallbackFeed.updateRoundData(1, -100, 0, 0);
    await expect(oracle.getLatestPrice()).to.be.revertedWith("Invalid fallback price");
  });

  it("should reject incomplete rounds", async function () {
    // roundId = 2, answeredInRound = 1
    await primaryFeed.setRoundId(2);
    await primaryFeed.setAnsweredInRound(1);
    
    const price = await oracle.getLatestPrice();
    expect(price).to.equal(2100e8); // Fallback
  });
});
