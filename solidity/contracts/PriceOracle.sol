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
    event StalePrice(address indexed oracle, uint256 lastUpdatedAt);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256) {
        (int256 price, bool valid) = _getPriceWithValidation(primaryFeed);
        if (valid) {
            return price;
        }

        // Primary oracle returned stale/invalid data — try fallback
        emit StalePrice(address(primaryFeed), block.timestamp);
        (int256 fallbackPrice, bool fallbackValid) = _getPriceWithValidation(fallbackFeed);
        if (fallbackValid) {
            return fallbackPrice;
        }

        // Both oracles stale/invalid
        revert("Both oracles returned invalid data");
    }

    function _getPriceWithValidation(AggregatorV3Interface feed) internal view returns (int256 price, bool valid) {
        try feed.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // Validate round completeness
            if (answeredInRound < roundId) {
                return (0, false);
            }

            // Validate price is positive
            if (answer <= 0) {
                return (0, false);
            }

            // Validate staleness
            if (block.timestamp - updatedAt >= MAX_STALENESS) {
                return (0, false);
            }

            return (answer, true);
        } catch {
            return (0, false);
        }
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
