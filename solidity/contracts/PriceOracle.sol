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
    event FallbackActivated(uint256 timestamp);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function _getValidPrice(AggregatorV3Interface feed) internal view returns (bool isValid, int256 validPrice) {
        try feed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            uint256 /* startedAt */,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            if (price > 0 && 
                answeredInRound >= roundId && 
                updatedAt > 0 && 
                block.timestamp - updatedAt <= MAX_STALENESS) 
            {
                return (true, price);
            }
        } catch {
            // feed call failed
        }
        return (false, 0);
    }

    // FIXED: Added staleness check, >0 check, round completeness, and a fallback oracle mechanism
    function getLatestPrice() external returns (int256) {
        (bool primaryValid, int256 primaryPrice) = _getValidPrice(primaryFeed);
        
        if (primaryValid) {
            emit PriceQueried(primaryPrice, block.timestamp);
            return primaryPrice;
        }

        emit FallbackActivated(block.timestamp);
        
        require(address(fallbackFeed) != address(0), "Primary failed and no fallback");
        
        (bool fallbackValid, int256 fallbackPrice) = _getValidPrice(fallbackFeed);
        require(fallbackValid, "Both oracles failed or stale");
        
        emit PriceQueried(fallbackPrice, block.timestamp);
        return fallbackPrice;
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
