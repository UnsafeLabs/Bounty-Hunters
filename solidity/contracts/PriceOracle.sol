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
    event StalePriceDetected(address feed, uint256 updatedAt);
    event FallbackTriggered(int256 price);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    // FIX: Add staleness check, negative/zero price check, round completeness check, and fallback
    function getLatestPrice() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        // FIX: Check for negative/zero price
        require(price > 0, "Invalid price: negative or zero");

        // FIX: Check for stale price (older than MAX_STALENESS)
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");

        // FIX: Check round completeness
        require(answeredInRound >= roundId, "Stale round");

        // Primary feed is valid
        emit PriceQueried(price, block.timestamp);
        return price;
    }

    // FIX: Add fallback oracle function
    function getLatestPriceWithFallback() external view returns (int256) {
        // Try primary first
        try primaryFeed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // Check if primary is valid
            if (price > 0 &&
                block.timestamp - updatedAt < MAX_STALENESS &&
                answeredInRound >= roundId) {
                emit PriceQueried(price, block.timestamp);
                return price;
            }
        } catch {
            // Fall through to fallback
        }

        // Fallback to secondary oracle
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = fallbackFeed.latestRoundData();

        // Validate fallback
        require(price > 0, "Invalid fallback price");
        require(block.timestamp - updatedAt < MAX_STALENESS * 2, "Stale fallback price");
        require(answeredInRound >= roundId, "Stale fallback round");

        emit StalePriceDetected(address(primaryFeed), updatedAt);
        emit FallbackTriggered(price);
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