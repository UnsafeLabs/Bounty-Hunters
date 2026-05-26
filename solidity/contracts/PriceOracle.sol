// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface AggregatorV3Interface {
    function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}

contract PriceOracle {
    AggregatorV3Interface public primaryFeed; AggregatorV3Interface public fallbackFeed;
    address public owner; uint256 public MAX_STALENESS = 3600;
    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(address indexed oracle, uint256 lastUpdateTimestamp);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed); fallbackFeed = AggregatorV3Interface(_fallbackFeed); owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256) {
        (int256 price, uint256 updatedAt, bool valid) = _getValidatedPrice(primaryFeed);
        if (valid) { emit PriceQueried(price, updatedAt); return price; }
        emit StalePrice(address(primaryFeed), updatedAt);
        (int256 fallbackPrice, uint256 fallbackUpdatedAt, bool fallbackValid) = _getValidatedPrice(fallbackFeed);
        if (fallbackValid) { emit PriceQueried(fallbackPrice, fallbackUpdatedAt); return fallbackPrice; }
        revert("Both oracles returned invalid data");
    }

    function _getValidatedPrice(AggregatorV3Interface feed) internal view returns (int256 price, uint256 updatedAt, bool valid) {
        try feed.latestRoundData() returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 _updatedAt, uint80 answeredInRound) {
            if (answer <= 0) return (0, _updatedAt, false);
            if (answeredInRound < roundId) return (0, _updatedAt, false);
            if (block.timestamp - _updatedAt >= MAX_STALENESS) return (0, _updatedAt, false);
            return (answer, _updatedAt, true);
        } catch { return (0, 0, false); }
    }

    function getDecimals() external view returns (uint8) { return primaryFeed.decimals(); }
    function setMaxStaleness(uint256 _maxStaleness) external { require(msg.sender == owner, "Not owner"); MAX_STALENESS = _maxStaleness; }
    function setFallbackFeed(address _fallbackFeed) external { require(msg.sender == owner, "Not owner"); fallbackFeed = AggregatorV3Interface(_fallbackFeed); }
}
