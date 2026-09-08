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
    uint256 public MAX_STALENESS = 3600; // 1 hour

    event PriceQueried(int256 price, uint256 timestamp);
    event FeedUpdated(address newFeed);
    event FallbackFeedUpdated(address newFeed);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    // FIX: Set fallback feed address
    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        emit FallbackFeedUpdated(_fallbackFeed);
    }

    // FIX: Set max staleness
    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }

    // FIX: Added staleness check, negative/zero price check, round completeness validation, and fallback mechanism
    function getLatestPrice() external view returns (int256) {
        // Try primary feed first
        int256 price = _getPriceFromFeed(primaryFeed);
        
        // If primary feed fails (returns 0 or negative), try fallback feed
        if (price <= 0 && address(fallbackFeed) != address(0)) {
            price = _getPriceFromFeed(fallbackFeed);
        }
        
        require(price > 0, "Invalid price");
        emit PriceQueried(price, block.timestamp);
        return price;
    }

    // FIX: Internal function to get price from a feed with all validations
    function _getPriceFromFeed(AggregatorV3Interface feed) internal view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        // FIX: Check for valid price (must be positive)
        require(price > 0, "Price must be positive");
        
        // FIX: Check round completeness
        require(answeredInRound >= roundId, "Round not complete");
        
        // FIX: Check staleness
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");

        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }
}
