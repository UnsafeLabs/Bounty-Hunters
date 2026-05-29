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
    event StalePrice(address feed, uint256 updatedAt, address fallbackFeed);

    constructor(address _primaryFeed, address _secondaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        secondaryFeed = AggregatorV3Interface(_secondaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (bool primaryOk, int256 primaryPrice) = _tryGetPrice(primaryFeed);
        if (primaryOk) {
            emit PriceQueried(primaryPrice, block.timestamp);
            return primaryPrice;
        }

        emit StalePrice(address(primaryFeed), block.timestamp, address(secondaryFeed));

        (bool secondaryOk, int256 secondaryPrice) = _tryGetPrice(secondaryFeed);
        require(secondaryOk, "Both oracles returned stale or invalid data");

        emit PriceQueried(secondaryPrice, block.timestamp);
        return secondaryPrice;
    }

    function _tryGetPrice(AggregatorV3Interface feed) internal view returns (bool ok, int256 price) {
        try feed.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            if (answer <= 0) return (false, 0);
            if (answeredInRound < roundId) return (false, 0);
            if (block.timestamp - updatedAt >= MAX_STALENESS) return (false, 0);
            return (true, answer);
        } catch {
            return (false, 0);
        }
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
