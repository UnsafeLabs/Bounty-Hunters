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
    event StalePrice(uint256 primaryUpdatedAt);

    constructor(address _primaryFeed, address _fallbackFeed) {
        require(_primaryFeed != address(0), "Invalid primary");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (
            bool primaryOk,
            int256 primaryPrice,
            uint256 primaryUpdatedAt
        ) = _tryRead(primaryFeed);

        if (primaryOk) {
            emit PriceQueried(primaryPrice, primaryUpdatedAt);
            return primaryPrice;
        }

        emit StalePrice(primaryUpdatedAt);

        (
            bool fallbackOk,
            int256 fallbackPrice,
            uint256 fallbackUpdatedAt
        ) = _tryRead(fallbackFeed);
        require(fallbackOk, "Stale price");

        emit PriceQueried(fallbackPrice, fallbackUpdatedAt);
        return fallbackPrice;
    }

    function _tryRead(AggregatorV3Interface feed)
        internal
        view
        returns (bool ok, int256 price, uint256 updatedAt)
    {
        require(address(feed) != address(0), "No feed");

        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updated,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answer > 0, "Invalid price");
        require(answeredInRound >= roundId, "Incomplete round");

        if (block.timestamp - updated >= MAX_STALENESS) {
            return (false, answer, updated);
        }
        return (true, answer, updated);
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
