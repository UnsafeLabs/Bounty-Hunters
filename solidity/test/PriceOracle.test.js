const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PriceOracle", function () {
  let oracle, mockFeed, mockFallback, owner;
  const ONE_HOUR = 3600;
  const VALID_PRICE = 2000n * 10n ** 8n;

  async function deployMockFeed(price, updatedAt, roundId, answeredInRound) {
    const Mock = await ethers.getContractFactory("AggregatorV3Interface");
    // Use a simple contract via hardhat's approach
    const MockFeed = await ethers.getContractFactory(
      "contracts/test/MockAggregator.sol:MockAggregator"
    );
    const feed = await MockFeed.deploy(price, updatedAt, roundId, answeredInRound);
    await feed.waitForDeployment();
    return feed;
  }

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    const now = Math.floor(Date.now() / 1000);
    const MockFeed = await ethers.getContractFactory("MockAggregator");
    mockFeed = await MockFeed.deploy(VALID_PRICE, now, 1, 1);
    await mockFeed.waitForDeployment();

    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    oracle = await PriceOracle.deploy(await mockFeed.getAddress());
    await oracle.waitForDeployment();
  });

  describe("Valid price", function () {
    it("should return price when data is fresh and valid", async function () {
      const price = await oracle.getLatestPrice.staticCall();
      expect(price).to.equal(VALID_PRICE);
    });
  });

  describe("Price validation", function () {
    it("should reject zero price", async function () {
      const now = Math.floor(Date.now() / 1000);
      const zeroFeed = await ethers.getContractFactory("MockAggregator");
      const zf = await zeroFeed.deploy(0, now, 1, 1);
      await zf.waitForDeployment();
      const Oracle = await ethers.getContractFactory("PriceOracle");
      const o = await Oracle.deploy(await zf.getAddress());
      await o.waitForDeployment();
      await expect(o.getLatestPrice()).to.be.revertedWith("Invalid price");
    });

    it("should reject negative price", async function () {
      const now = Math.floor(Date.now() / 1000);
      const negFeed = await ethers.getContractFactory("MockAggregator");
      const nf = await negFeed.deploy(-100, now, 1, 1);
      await nf.waitForDeployment();
      const Oracle = await ethers.getContractFactory("PriceOracle");
      const o = await Oracle.deploy(await nf.getAddress());
      await o.waitForDeployment();
      await expect(o.getLatestPrice()).to.be.revertedWith("Invalid price");
    });
  });

  describe("Round completeness", function () {
    it("should reject incomplete round (answeredInRound < roundId)", async function () {
      const now = Math.floor(Date.now() / 1000);
      const badFeed = await ethers.getContractFactory("MockAggregator");
      const bf = await badFeed.deploy(VALID_PRICE, now, 5, 3);
      await bf.waitForDeployment();
      const Oracle = await ethers.getContractFactory("PriceOracle");
      const o = await Oracle.deploy(await bf.getAddress());
      await o.waitForDeployment();
      await expect(o.getLatestPrice()).to.be.revertedWith("Round incomplete");
    });
  });

  describe("Staleness check", function () {
    it("should reject stale data (older than MAX_STALENESS)", async function () {
      const staleTime = Math.floor(Date.now() / 1000) - 7200; // 2 hours old
      const staleFeed = await ethers.getContractFactory("MockAggregator");
      const sf = await staleFeed.deploy(VALID_PRICE, staleTime, 1, 1);
      await sf.waitForDeployment();
      const Oracle = await ethers.getContractFactory("PriceOracle");
      const o = await Oracle.deploy(await sf.getAddress());
      await o.waitForDeployment();
      await expect(o.getLatestPrice()).to.be.revertedWith("Stale price");
    });
  });

  describe("Fallback oracle", function () {
    it("should use fallback when primary is stale and fallback is fresh", async function () {
      const now = Math.floor(Date.now() / 1000);
      const staleTime = now - 7200;

      const MockFeed = await ethers.getContractFactory("MockAggregator");
      const primary = await MockFeed.deploy(VALID_PRICE, staleTime, 1, 1);
      await primary.waitForDeployment();
      const fallback = await MockFeed.deploy(VALID_PRICE, now, 1, 1);
      await fallback.waitForDeployment();

      const Oracle = await ethers.getContractFactory("PriceOracle");
      const o = await Oracle.deploy(await primary.getAddress());
      await o.waitForDeployment();
      await o.setFallbackFeed(await fallback.getAddress());

      const price = await o.getLatestPrice.staticCall();
      expect(price).to.equal(VALID_PRICE);
    });

    it("should revert if both oracles are stale", async function () {
      const staleTime = Math.floor(Date.now() / 1000) - 7200;

      const MockFeed = await ethers.getContractFactory("MockAggregator");
      const primary = await MockFeed.deploy(VALID_PRICE, staleTime, 1, 1);
      await primary.waitForDeployment();
      const fallback = await MockFeed.deploy(VALID_PRICE, staleTime, 1, 1);
      await fallback.waitForDeployment();

      const Oracle = await ethers.getContractFactory("PriceOracle");
      const o = await Oracle.deploy(await primary.getAddress());
      await o.waitForDeployment();
      await o.setFallbackFeed(await fallback.getAddress());

      await expect(o.getLatestPrice()).to.be.revertedWith("Stale price");
    });
  });

  describe("Ownership", function () {
    it("should allow owner to set MAX_STALENESS", async function () {
      await oracle.setMaxStaleness(1800);
      expect(await oracle.MAX_STALENESS()).to.equal(1800);
    });

    it("should allow owner to set fallback feed", async function () {
      const now = Math.floor(Date.now() / 1000);
      const MockFeed = await ethers.getContractFactory("MockAggregator");
      const fb = await MockFeed.deploy(VALID_PRICE, now, 1, 1);
      await fb.waitForDeployment();
      await oracle.setFallbackFeed(await fb.getAddress());
      expect(await oracle.fallbackFeed()).to.equal(await fb.getAddress());
    });
  });
});
