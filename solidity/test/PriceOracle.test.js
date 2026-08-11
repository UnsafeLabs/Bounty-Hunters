const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PriceOracle", function () {
  async function deploy(primaryOpts = {}, fallbackOpts = {}) {
    const Mock = await ethers.getContractFactory("MockAggregator");
    const primary = await Mock.deploy();
    const fallback = await Mock.deploy();

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await primary.setRound(
      primaryOpts.roundId ?? 1,
      primaryOpts.price ?? 1000,
      primaryOpts.updatedAt ?? now,
      primaryOpts.answeredInRound ?? 1
    );
    await fallback.setRound(
      fallbackOpts.roundId ?? 1,
      fallbackOpts.price ?? 2000,
      fallbackOpts.updatedAt ?? now,
      fallbackOpts.answeredInRound ?? 1
    );

    const Oracle = await ethers.getContractFactory("PriceOracle");
    const oracle = await Oracle.deploy(await primary.getAddress(), await fallback.getAddress());
    return { oracle, primary, fallback, now };
  }

  it("returns valid primary price", async function () {
    const { oracle } = await deploy();
    expect(await oracle.getLatestPrice.staticCall()).to.equal(1000);
  });

  it("rejects negative or zero prices", async function () {
    const { oracle, primary, now } = await deploy();
    await primary.setRound(1, 0, now, 1);
    await expect(oracle.getLatestPrice()).to.be.revertedWith("Invalid price");
  });

  it("rejects incomplete rounds", async function () {
    const { oracle, primary, now } = await deploy({ answeredInRound: 0, roundId: 2 });
    await expect(oracle.getLatestPrice()).to.be.revertedWith("Incomplete round");
  });

  it("falls back on stale primary and emits StalePrice", async function () {
    const { oracle, primary, now } = await deploy();
    await primary.setRound(1, 1000, now - 7200, 1);
    await expect(oracle.getLatestPrice())
      .to.emit(oracle, "StalePrice")
      .withArgs(now - 7200);
    expect(await oracle.getLatestPrice.staticCall()).to.equal(2000);
  });

  it("reverts when both oracles are stale", async function () {
    const { oracle, primary, fallback, now } = await deploy();
    await primary.setRound(1, 1000, now - 7200, 1);
    await fallback.setRound(1, 2000, now - 7200, 1);
    await expect(oracle.getLatestPrice()).to.be.revertedWith("Stale price");
  });

  it("owner can configure MAX_STALENESS", async function () {
    const { oracle } = await deploy();
    await oracle.setMaxStaleness(120);
    expect(await oracle.MAX_STALENESS()).to.equal(120);
  });
});
