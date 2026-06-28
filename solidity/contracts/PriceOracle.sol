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

    event PriceQueried(address indexed feed, int256 price, uint256 timestamp);
    event StalePrice(address indexed feed, uint256 updatedAt);
    event FallbackFeedUpdated(address indexed fallbackFeed);
    event MaxStalenessUpdated(uint256 maxStaleness);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _primaryFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (
            int256 primaryPrice,
            uint256 primaryUpdatedAt,
            bool primaryStale
        ) = _readFeed(primaryFeed);

        if (!primaryStale) {
            emit PriceQueried(address(primaryFeed), primaryPrice, primaryUpdatedAt);
            return primaryPrice;
        }

        emit StalePrice(address(primaryFeed), primaryUpdatedAt);
        require(address(fallbackFeed) != address(0), "Stale price");

        (int256 fallbackPrice, uint256 fallbackUpdatedAt, bool fallbackStale) = _readFeed(
            fallbackFeed
        );
        require(!fallbackStale, "Stale price");

        emit PriceQueried(address(fallbackFeed), fallbackPrice, fallbackUpdatedAt);
        return fallbackPrice;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setFallbackFeed(address _fallbackFeed) external onlyOwner {
        require(_fallbackFeed != address(0), "Invalid fallback feed");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        emit FallbackFeedUpdated(_fallbackFeed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Invalid staleness");
        MAX_STALENESS = _maxStaleness;
        emit MaxStalenessUpdated(_maxStaleness);
    }

    function _readFeed(
        AggregatorV3Interface feed
    ) private view returns (int256 price, uint256 updatedAt, bool isStale) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 feedUpdatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answer > 0, "Invalid price");
        require(answeredInRound >= roundId, "Incomplete round");
        require(feedUpdatedAt != 0, "Incomplete round");

        return (answer, feedUpdatedAt, block.timestamp - feedUpdatedAt >= MAX_STALENESS);
    }
}
