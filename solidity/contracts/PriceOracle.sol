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
    AggregatorV3Interface public secondaryFeed;
    address public owner;
    uint256 public MAX_STALENESS = 3600;

    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(uint256 primaryUpdatedAt, uint256 fallbackTimestamp);

    constructor(address _primaryFeed, address _secondaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        secondaryFeed = AggregatorV3Interface(_secondaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256) {
        (int256 price, uint256 updatedAt) = _getPriceFromFeed(primaryFeed);

        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            (int256 fallbackPrice, uint256 fallbackUpdatedAt) = _getPriceFromFeed(secondaryFeed);

            if (block.timestamp - fallbackUpdatedAt >= MAX_STALENESS) {
                revert("Both oracles stale");
            }

            return fallbackPrice;
        }

        return price;
    }

    function _getPriceFromFeed(AggregatorV3Interface feed) internal view returns (int256 price, uint256 updatedAt) {
        (
            uint80 roundId,
            int256 rawPrice,
            ,
            uint256 rawUpdatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answeredInRound >= roundId, "Incomplete round");
        require(rawPrice > 0, "Invalid price");

        return (rawPrice, rawUpdatedAt);
    }

    function getLatestPriceWithStaleness() external view returns (int256 price, bool isStale) {
        try primaryFeed.latestRoundData() returns (
            uint80 roundId,
            int256 rawPrice,
            ,
            uint256 rawUpdatedAt,
            uint80 answeredInRound
        ) {
            if (rawPrice > 0 && answeredInRound >= roundId) {
                isStale = block.timestamp - rawUpdatedAt >= MAX_STALENESS;
                return (rawPrice, isStale);
            }
        } catch {
            return (0, true);
        }
        return (0, true);
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }

    function setSecondaryFeed(address _secondaryFeed) external {
        require(msg.sender == owner, "Not owner");
        secondaryFeed = AggregatorV3Interface(_secondaryFeed);
    }
}
