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
    event StalePrice(uint256 indexed timestamp);

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

        require(price > 0, "Invalid price");
        require(answeredInRound >= roundId, "Incomplete round");

        if (block.timestamp - updatedAt < MAX_STALENESS) {
            return price;
        }

        emit StalePrice(updatedAt);

        (
            uint80 roundId2,
            int256 price2,
            ,
            uint256 updatedAt2,
            uint80 answeredInRound2
        ) = secondaryFeed.latestRoundData();

        require(price2 > 0, "Invalid price");
        require(answeredInRound2 >= roundId2, "Incomplete round");
        require(block.timestamp - updatedAt2 < MAX_STALENESS, "Both oracles stale");

        return price2;
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
