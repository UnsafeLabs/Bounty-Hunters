import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("PriceOracle", function () {
  let oracle: any;
  let mockPrimary: any;
  let mockSecondary: any;
  const VALID_PRICE = 200000000000n; // $2000 with 8 decimals
  const MAX_STALENESS = 3600;

  async function deployMockFeed(price: bigint, updatedAt: number, roundId: number, answeredInRound: number) {
    const MockFeed = await ethers.getContractFactory("MockAggregator");
    return MockFeed.deploy(price, updatedAt, roundId, answeredInRound);
  }

  async function deployOracle(primaryAddr: string, secondaryAddr: string) {
    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    return PriceOracle.deploy(primaryAddr, secondaryAddr);
  }

  async function freshFeeds(
    primaryPrice = VALID_PRICE,
    primaryAgo = 0,
    primaryRound = 1,
    primaryAnswered = 1,
    secondaryPrice = VALID_PRICE,
    secondaryAgo = 0
  ) {
    const now = await time.latest();
    mockPrimary = await deployMockFeed(primaryPrice, now - primaryAgo, primaryRound, primaryAnswered);
    mockSecondary = await deployMockFeed(secondaryPrice, now - secondaryAgo, 1, 1);
    oracle = await deployOracle(await mockPrimary.getAddress(), await mockSecondary.getAddress());
  }

  it("returns valid price from primary feed", async function () {
    await freshFeeds();
    expect(await oracle.getLatestPrice()).to.equal(VALID_PRICE);
  });

  it("reverts when price is zero", async function () {
    await freshFeeds(0n);
    await expect(oracle.getLatestPrice()).to.be.revertedWith("Invalid price");
  });

  it("reverts when price is negative", async function () {
    await freshFeeds(-1n);
    await expect(oracle.getLatestPrice()).to.be.revertedWith("Invalid price");
  });

  it("reverts when round is incomplete", async function () {
    // answeredInRound (2) < roundId (5) → incomplete
    await freshFeeds(VALID_PRICE, 0, 5, 2);
    await expect(oracle.getLatestPrice()).to.be.revertedWith("Incomplete round");
  });

  it("emits StalePrice and falls back to secondary when primary is stale", async function () {
    await freshFeeds(VALID_PRICE, MAX_STALENESS + 1); // primary stale
    const tx = await oracle.getLatestPrice();
    await expect(tx).to.emit(oracle, "StalePrice");
    // secondary is fresh — should succeed
  });

  it("uses secondary oracle price when primary is stale", async function () {
    const secondaryPrice = 190000000000n; // different price
    await freshFeeds(VALID_PRICE, MAX_STALENESS + 1, 1, 1, secondaryPrice, 0);
    expect(await oracle.getLatestPrice()).to.equal(secondaryPrice);
  });

  it("reverts when both oracles are stale", async function () {
    await freshFeeds(VALID_PRICE, MAX_STALENESS + 1, 1, 1, VALID_PRICE, MAX_STALENESS + 1);
    await expect(oracle.getLatestPrice()).to.be.revertedWith("Both oracles stale");
  });

  it("allows owner to update MAX_STALENESS", async function () {
    await freshFeeds();
    await oracle.setMaxStaleness(7200);
    expect(await oracle.MAX_STALENESS()).to.equal(7200);
  });

  it("reverts when non-owner tries to set MAX_STALENESS", async function () {
    await freshFeeds();
    const [, other] = await ethers.getSigners();
    await expect(oracle.connect(other).setMaxStaleness(7200)).to.be.revertedWith("Not owner");
  });

  it("emits PriceQueried on valid price", async function () {
    await freshFeeds();
    await expect(oracle.getLatestPrice()).to.emit(oracle, "PriceQueried");
  });
});
