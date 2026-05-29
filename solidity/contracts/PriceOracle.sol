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
    event StalePrice(uint256 primaryUpdatedAt, uint256 timestamp);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        // Check round completeness
        require(answeredInRound >= roundId, "Round not complete");
        // Check for zero/negative price
        require(price > 0, "Invalid price");
        // Check staleness
        if (block.timestamp - updatedAt < MAX_STALENESS) {
            return price;
        }

        // Primary is stale — try fallback
        (
            uint80 fallbackRoundId,
            int256 fallbackPrice,
            ,
            uint256 fallbackUpdatedAt,
            uint80 fallbackAnsweredInRound
        ) = fallbackFeed.latestRoundData();

        // Validate fallback oracle
        require(fallbackAnsweredInRound >= fallbackRoundId, "Fallback round not complete");
        require(fallbackPrice > 0, "Fallback invalid price");
        require(block.timestamp - fallbackUpdatedAt < MAX_STALENESS, "Both oracles stale");

        // Emit stale price event for monitoring
        emit StalePrice(updatedAt, block.timestamp);

        return fallbackPrice;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
