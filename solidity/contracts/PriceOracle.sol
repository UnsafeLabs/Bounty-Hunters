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

    event PriceQueried(int256 price, uint256 timestamp, bool usedFallback);
    event FallbackFeedSet(address indexed fallbackFeed);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    // FIX: Added staleness check, price validation, round completeness, and fallback
    function getLatestPrice() external view returns (int256) {
        try primaryFeed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // Check round completeness
            require(answeredInRound >= roundId, "Round not complete");
            // Check staleness
            require(block.timestamp - updatedAt < MAX_STALENESS, "Price is stale");
            // Check price validity
            require(price > 0, "Invalid price");
            
            return price;
        } catch {
            // Fallback to secondary oracle
            return _getFallbackPrice();
        }
    }

    // FIX: Added fallback oracle support
    function _getFallbackPrice() internal view returns (int256) {
        require(address(fallbackFeed) != address(0), "No fallback feed");
        
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = fallbackFeed.latestRoundData();
        
        require(answeredInRound >= roundId, "Fallback round not complete");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Fallback price is stale");
        require(price > 0, "Invalid fallback price");
        
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
        emit FallbackFeedSet(_fallbackFeed);
    }
}
