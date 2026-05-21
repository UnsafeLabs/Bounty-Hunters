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

    function getLatestPrice() external view returns (int256) {
        (uint80 roundId, int256 price, , uint256 updatedAt, uint80 answeredInRound) = primaryFeed.latestRoundData();
        require(price > 0, "Invalid price");
        require(answeredInRound >= roundId, "Round not complete");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Price stale");
        return price;
    }

    function getLatestPriceWithFallback() external view returns (int256) {
        (uint80 roundId, int256 price, , uint256 updatedAt, uint80 answeredInRound) = primaryFeed.latestRoundData();
        if (price > 0 && answeredInRound >= roundId && block.timestamp - updatedAt < MAX_STALENESS) {
            return price;
        }
        (uint80 fr, int256 fp, , uint256 fu, uint80 fa) = fallbackFeed.latestRoundData();
        require(fp > 0, "Both oracles failed");
        require(fa >= fr, "Fallback round not complete");
        require(block.timestamp - fu < MAX_STALENESS, "Fallback stale");
        return fp;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
