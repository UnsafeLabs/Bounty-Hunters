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
    event FallbackUsed(int256 price, uint256 timestamp);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256) {
        (int256 price, bool valid) = _tryGetPrice(primaryFeed);
        if (valid) return price;
        (price, valid) = _tryGetPrice(fallbackFeed);
        require(valid, "All oracles stale or invalid");
        return price;
    }

    function _tryGetPrice(AggregatorV3Interface feed) internal view returns (int256 price, bool valid) {
        (
            uint80 roundId,
            int256 _price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        // Check for positive price
        if (_price <= 0) return (0, false);
        // Check round completeness
        if (answeredInRound < roundId) return (0, false);
        // Check staleness
        if (block.timestamp > updatedAt + MAX_STALENESS) return (0, false);

        return (_price, true);
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
