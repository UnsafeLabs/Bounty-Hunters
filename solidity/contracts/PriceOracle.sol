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
    AggregatorV3Interface public secondaryFeed;
    address public owner;
    uint256 public MAX_STALENESS = 3600;

    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(uint256 primaryUpdatedAt, uint256 secondaryUpdatedAt);
    event FallbackOracleSet(address indexed newFallback);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256 price) {
        (price, bool stale) = _checkFeed(primaryFeed);
        if (!stale) {
            require(price > 0, "Invalid price");
            return price;
        }

        require(address(secondaryFeed) != address(0), "No fallback oracle");
        (int256 fallbackPrice, bool fallbackStale) = _checkFeed(secondaryFeed);
        require(!fallbackStale, "Both oracles stale");
        emit FallbackOracleSet(address(secondaryFeed));
        return fallbackPrice;
    }

    function _checkFeed(AggregatorV3Interface feed) private view returns (int256 price, bool stale) {
        (
            uint80 roundId,
            int256 price_,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answeredInRound >= roundId, "Incomplete round");
        if (price_ <= 0) return (0, true);
        if (block.timestamp - updatedAt > MAX_STALENESS) return (0, true);

        emit PriceQueried(price_, updatedAt);
        return (price_, false);
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }

    function setFallbackOracle(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        require(_fallbackFeed != address(0), "Zero address");
        secondaryFeed = AggregatorV3Interface(_fallbackFeed);
        emit FallbackOracleSet(_fallbackFeed);
    }
}
