const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PriceOracle Security Tests", function () {
    let oracle;
    let primaryFeed;
    let fallbackFeed;
    let owner;
    let user;

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();

        // Deploy Mock V3 Aggregators
        // Constructor of MockV3Aggregator usually takes: decimals, initialAnswer
        const MockFeed = await ethers.getContractFactory("MockV3Aggregator");
        primaryFeed = await MockFeed.deploy(8, 2000e8); // $2000 ETH
        await primaryFeed.deployed();

        fallbackFeed = await MockFeed.deploy(8, 2100e8); // $2100 ETH fallback
        await fallbackFeed.deployed();

        // Deploy PriceOracle
        const PriceOracle = await ethers.getContractFactory("PriceOracle");
        oracle = await PriceOracle.deploy(primaryFeed.address, fallbackFeed.address);
        await oracle.deployed();
    });

    it("Should return primary price when it is valid", async function () {
        // MockV3Aggregator sets current block.timestamp as updatedAt by default
        const price = await oracle.callStatic.getLatestPrice();
        expect(price).to.equal(2000e8);
    });

    it("Should fallback to secondary when primary is stale", async function () {
        const now = (await ethers.provider.getBlock("latest")).timestamp;
        const staleTime = now - 7200; // 2 hours ago (MAX_STALENESS is 3600)

        // Update primary round data: roundId, answer, startedAt, updatedAt, answeredInRound
        await primaryFeed.updateRoundData(1, 2000e8, staleTime, staleTime);

        // We expect it to fallback and emit StalePrice
        await expect(oracle.getLatestPrice())
            .to.emit(oracle, "StalePrice")
            .withArgs(staleTime);

        const price = await oracle.callStatic.getLatestPrice();
        expect(price).to.equal(2100e8);
    });

    it("Should revert if both primary and secondary are stale", async function () {
        const now = (await ethers.provider.getBlock("latest")).timestamp;
        const staleTime = now - 7200;

        await primaryFeed.updateRoundData(1, 2000e8, staleTime, staleTime);
        await fallbackFeed.updateRoundData(1, 2100e8, staleTime, staleTime);

        await expect(oracle.getLatestPrice()).to.be.revertedWith("Fallback price stale");
    });

    it("Should revert on negative or zero prices", async function () {
        await primaryFeed.updateRoundData(1, 0, 0, 0); // Invalid primary
        await fallbackFeed.updateRoundData(1, -100, 0, 0); // Negative fallback

        await expect(oracle.getLatestPrice()).to.be.revertedWith("Invalid fallback price");
    });

    it("Should allow owner to configure MAX_STALENESS", async function () {
        await oracle.connect(owner).setMaxStaleness(1800);
        expect(await oracle.MAX_STALENESS()).to.equal(1800);

        await expect(oracle.connect(user).setMaxStaleness(500))
            .to.be.revertedWith("Not owner");
    });
});
