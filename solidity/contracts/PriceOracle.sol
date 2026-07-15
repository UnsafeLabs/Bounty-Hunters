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

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256 price) {
        (price, , ) = _getLatestPriceFromFeed(primaryFeed);
        if (price <= 0) {
            (price, , ) = _getLatestPriceFromFeed(fallbackFeed);
        }
        require(price > 0, "Invalid price from both oracles");
        emit PriceQueried(price, block.timestamp);
    }

    function _getLatestPriceFromFeed(AggregatorV3Interface feed) internal view returns (int256 price, uint256 updatedAt, uint80 answeredInRound) {
        uint80 roundId;
        (roundId, price, , updatedAt, answeredInRound) = feed.latestRoundData();
        if (price <= 0) return (0, updatedAt, answeredInRound);
        require(answeredInRound >= roundId, "Stale round");
        require(block.timestamp - updatedAt <= MAX_STALENESS, "Price stale");
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
