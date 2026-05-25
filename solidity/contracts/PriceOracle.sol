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
    event StalePrice(uint256 timestamp, string reason);

    constructor(address _primaryFeed, address _secondaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        secondaryFeed = AggregatorV3Interface(_secondaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        // Validate primary feed
        bool primaryValid = true;

        if (answeredInRound < roundId) {
            primaryValid = false;
        }
        if (price <= 0) {
            primaryValid = false;
        }
        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            primaryValid = false;
        }

        if (primaryValid) {
            return price;
        }

        // Primary feed is stale or invalid, try secondary
        emit StalePrice(block.timestamp, "Primary feed stale or invalid");

        (
            uint80 secRoundId,
            int256 secPrice,
            ,
            uint256 secUpdatedAt,
            uint80 secAnsweredInRound
        ) = secondaryFeed.latestRoundData();

        require(secAnsweredInRound >= secRoundId, "Secondary feed: round not complete");
        require(secPrice > 0, "Secondary feed: invalid price");
        require(block.timestamp - secUpdatedAt < MAX_STALENESS, "Secondary feed: price stale");

        return secPrice;
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
