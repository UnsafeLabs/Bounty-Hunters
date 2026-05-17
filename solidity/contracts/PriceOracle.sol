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
    event StalePrice(uint256 timestamp);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }

    function getLatestPrice() external view returns (int256) {
        // Try primary feed
        (bool primaryStale, int256 price, uint256 updatedAt) = _getPriceFromFeed(primaryFeed);
        if (!primaryStale) {
            return price;
        }
        emit StalePrice(updatedAt);

        // Fallback oracle check
        require(address(fallbackFeed) != address(0), "No fallback set");
        (bool fallbackStale, int256 fallbackPrice, uint256 fallbackUpdatedAt) = _getPriceFromFeed(fallbackFeed);
        if (!fallbackStale) {
            return fallbackPrice;
        }
        emit StalePrice(fallbackUpdatedAt);
        revert("Both oracles stale");
    }

    function _getPriceFromFeed(AggregatorV3Interface feed) internal view returns (bool stale, int256 price, uint256 updatedAt) {
        (
            uint80 roundId,
            int256 feedPrice,
            ,
            uint256 feedUpdatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        // Round completeness check
        require(answeredInRound >= roundId, "Incomplete round");
        // Negative/zero price check
        require(feedPrice > 0, "Invalid price");
        // Staleness check
        stale = (block.timestamp - feedUpdatedAt >= MAX_STALENESS);
        price = feedPrice;
        updatedAt = feedUpdatedAt;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
