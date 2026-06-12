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
    event StalePrice(uint256 lastUpdatedAt);

    constructor(address _primaryFeed, address _secondaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        secondaryFeed = AggregatorV3Interface(_secondaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        require(answeredInRound >= roundId, "Incomplete round");
        require(price > 0, "Invalid price");

        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            emit StalePrice(updatedAt);
            return _getFallbackPrice();
        }

        emit PriceQueried(price, block.timestamp);
        return price;
    }

    function _getFallbackPrice() internal returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = secondaryFeed.latestRoundData();

        require(answeredInRound >= roundId, "Secondary: incomplete round");
        require(price > 0, "Secondary: invalid price");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Both oracles stale");

        emit PriceQueried(price, block.timestamp);
        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
