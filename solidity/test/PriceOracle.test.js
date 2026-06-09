const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PriceOracle", function () {
  let primaryFeed;
  let fallbackFeed;
  let oracle;
  let owner;
  let user;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy Mock Aggregators
    const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
    primaryFeed = await MockV3Aggregator.deploy();
    if (primaryFeed.waitForDeployment) {
      await primaryFeed.waitForDeployment();
    } else if (primaryFeed.deployed) {
      await primaryFeed.deployed();
    }

    fallbackFeed = await MockV3Aggregator.deploy();
    if (fallbackFeed.waitForDeployment) {
      await fallbackFeed.waitForDeployment();
    } else if (fallbackFeed.deployed) {
      await fallbackFeed.deployed();
    }

    const primaryAddress = primaryFeed.target || primaryFeed.address;
    const fallbackAddress = fallbackFeed.target || fallbackFeed.address;

    // Deploy PriceOracle
    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    oracle = await PriceOracle.deploy(primaryAddress, fallbackAddress);
    if (oracle.waitForDeployment) {
      await oracle.waitForDeployment();
    } else if (oracle.deployed) {
      await oracle.deployed();
    }
  });

  it("should return primary price if it is valid and not stale", async function () {
    const now = Math.floor(Date.now() / 1000);
    await primaryFeed.setLatestRoundData(1, 200000000, now, now, 1); // 2 USD, current time
    await fallbackFeed.setLatestRoundData(1, 190000000, now, now, 1);

    // Call getLatestPrice
    const tx = await oracle.getLatestPrice();
    const receipt = await tx.wait();

    // Verify event PriceQueried
    const priceQueriedEvent = receipt.logs
      .map((log) => {
        try {
          return oracle.interface.parseLog(log);
        } catch (e) {
          return null;
        }
      })
      .find((x) => x && x.name === "PriceQueried");

    expect(priceQueriedEvent).to.not.be.null;
    expect(priceQueriedEvent.args.price).to.equal(200000000);
  });

  it("should revert if primary price is negative or zero", async function () {
    const now = Math.floor(Date.now() / 1000);
    await primaryFeed.setLatestRoundData(1, 0, now, now, 1); // zero price
    await expect(oracle.getLatestPrice()).to.be.revertedWith("Invalid price");

    await primaryFeed.setLatestRoundData(1, -100, now, now, 1); // negative price
    await expect(oracle.getLatestPrice()).to.be.revertedWith("Invalid price");
  });

  it("should revert if primary round is incomplete", async function () {
    const now = Math.floor(Date.now() / 1000);
    await primaryFeed.setLatestRoundData(2, 200000000, now, now, 1); // answeredInRound (1) < roundId (2)
    await expect(oracle.getLatestPrice()).to.be.revertedWith("Incomplete round");
  });

  it("should fallback to secondary oracle when primary is stale", async function () {
    const now = Math.floor(Date.now() / 1000);
    const staleTime = now - 4000; // stale (older than 3600s)

    await primaryFeed.setLatestRoundData(1, 200000000, staleTime, staleTime, 1);
    await fallbackFeed.setLatestRoundData(1, 195000000, now, now, 1); // fallback is valid

    const tx = await oracle.getLatestPrice();
    const receipt = await tx.wait();

    const events = receipt.logs.map((log) => {
      try {
        return oracle.interface.parseLog(log);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    // Verify StalePrice event was emitted with primary's last update time
    const stalePriceEvent = events.find((x) => x.name === "StalePrice");
    expect(stalePriceEvent).to.not.be.undefined;
    expect(stalePriceEvent.args.lastUpdatedAt).to.equal(staleTime);

    // Verify PriceQueried event contains the fallback price
    const priceQueriedEvent = events.find((x) => x.name === "PriceQueried");
    expect(priceQueriedEvent).to.not.be.undefined;
    expect(priceQueriedEvent.args.price).to.equal(195000000);
  });

  it("should revert if both primary and fallback oracles return stale prices", async function () {
    const now = Math.floor(Date.now() / 1000);
    const staleTime = now - 4000;

    await primaryFeed.setLatestRoundData(1, 200000000, staleTime, staleTime, 1);
    await fallbackFeed.setLatestRoundData(1, 195000000, staleTime, staleTime, 1);

    await expect(oracle.getLatestPrice()).to.be.revertedWith("Stale price");
  });

  it("should allow owner to configure MAX_STALENESS", async function () {
    expect(await oracle.MAX_STALENESS()).to.equal(3600);

    // Set by owner
    await oracle.setMaxStaleness(1800);
    expect(await oracle.MAX_STALENESS()).to.equal(1800);

    // Revert if set by non-owner
    await expect(oracle.connect(user).setMaxStaleness(1000)).to.be.revertedWithCustomError
      ? expect(oracle.connect(user).setMaxStaleness(1000)).to.be.reverted
      : expect(oracle.connect(user).setMaxStaleness(1000)).to.be.revertedWith("Ownable: caller is not the owner");
  });
});
