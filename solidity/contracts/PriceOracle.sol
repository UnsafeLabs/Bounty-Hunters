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
    event StalePrice(uint256 primaryUpdatedAt, uint256 fallbackUpdatedAt);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256) {
        (int256 price, bool isValid, uint256 updatedAt) = _getValidatedPrice(primaryFeed);

        if (isValid) {
            return price;
        }

        // Fallback to secondary oracle when primary is stale
        if (address(fallbackFeed) != address(0)) {
            (int256 fallbackPrice, bool fallbackValid, uint256 fallbackUpdatedAt) = _getValidatedPrice(fallbackFeed);
            if (fallbackValid) {
                emit StalePrice(updatedAt, fallbackUpdatedAt);
                return fallbackPrice;
            }
        }

        revert("Both oracles stale or invalid");
    }

    function _getValidatedPrice(AggregatorV3Interface feed) internal view returns (int256 price, bool isValid, uint256 updatedAt) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 lastUpdatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        if (answer <= 0) {
            return (0, false, lastUpdatedAt);
        }

        if (answeredInRound < roundId) {
            return (0, false, lastUpdatedAt);
        }

        if (block.timestamp - lastUpdatedAt >= MAX_STALENESS) {
            return (0, false, lastUpdatedAt);
        }

        return (answer, true, lastUpdatedAt);
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
