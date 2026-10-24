// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}

contract PriceOracle {
    AggregatorV3Interface public primaryFeed;
    AggregatorV3Interface public fallbackFeed;
    address public owner;
    uint256 public MAX_STALENESS = 3600;

    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(uint256 primaryUpdatedAt);
    event FallbackFeedUpdated(address indexed feed);
    event MaxStalenessUpdated(uint256 maxStaleness);

    constructor(address _primaryFeed) {
        require(_primaryFeed != address(0), "Primary feed required");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (int256 price, uint256 updatedAt, bool stale) = _readFeed(primaryFeed);
        if (!stale) {
            emit PriceQueried(price, updatedAt);
            return price;
        }

        require(address(fallbackFeed) != address(0), "No fallback oracle");
        (int256 fallbackPrice, uint256 fallbackUpdatedAt, bool fallbackStale) = _readFeed(fallbackFeed);
        require(!fallbackStale, "Both oracles stale");

        emit StalePrice(updatedAt);
        emit PriceQueried(fallbackPrice, fallbackUpdatedAt);
        return fallbackPrice;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        emit FallbackFeedUpdated(_fallbackFeed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        require(_maxStaleness > 0, "Invalid staleness");
        MAX_STALENESS = _maxStaleness;
        emit MaxStalenessUpdated(_maxStaleness);
    }

    function _readFeed(AggregatorV3Interface feed)
        internal
        view
        returns (int256 price, uint256 updatedAt, bool stale)
    {
        uint80 roundId;
        uint80 answeredInRound;
        (roundId, price, , updatedAt, answeredInRound) = feed.latestRoundData();
        require(price > 0, "Invalid price");
        require(roundId > 0 && answeredInRound >= roundId, "Incomplete round");
        require(updatedAt > 0 && updatedAt <= block.timestamp, "Invalid timestamp");
        stale = block.timestamp - updatedAt >= MAX_STALENESS;
    }
}
