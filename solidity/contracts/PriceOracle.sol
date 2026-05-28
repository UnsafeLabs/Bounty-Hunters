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

    error InvalidPrice();
    error StalePrice();
    error IncompleteRound();

    event PriceQueried(int256 price, uint256 timestamp);
    event FallbackFeedUsed(uint256 timestamp);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        // Validate round completeness
        if (answeredInRound < roundId) {
            revert IncompleteRound();
        }

        // Validate price is positive
        if (price <= 0) {
            // Try fallback oracle
            return _getFallbackPrice();
        }

        // Validate staleness
        if (block.timestamp - updatedAt > MAX_STALENESS) {
            // Try fallback oracle
            return _getFallbackPrice();
        }

        return price;
    }

    function _getFallbackPrice() internal view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = fallbackFeed.latestRoundData();

        // Validate fallback round completeness
        if (answeredInRound < roundId) {
            revert IncompleteRound();
        }

        // Validate fallback price is positive
        if (price <= 0) {
            revert InvalidPrice();
        }

        // Validate fallback staleness
        if (block.timestamp - updatedAt > MAX_STALENESS) {
            revert StalePrice();
        }

        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }

    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }
}
