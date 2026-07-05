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
    event StalePrice(address indexed feed, uint256 updatedAt);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (
            int256 price,
            uint256 updatedAt
        ) = _readFeed(primaryFeed);

        if (!_isStale(updatedAt)) {
            _requireFresh(updatedAt);
            emit PriceQueried(price, updatedAt);
            return price;
        }

        require(address(fallbackFeed) != address(0), "Fallback not set");
        emit StalePrice(address(primaryFeed), updatedAt);

        (
            int256 fallbackPrice,
            uint256 fallbackUpdatedAt
        ) = _readFeed(fallbackFeed);

        _requireFresh(fallbackUpdatedAt);
        emit PriceQueried(fallbackPrice, fallbackUpdatedAt);
        return fallbackPrice;
    }

    function _readFeed(AggregatorV3Interface feed) internal view returns (
        int256 price,
        uint256 updatedAt
    ) {
        (
            uint80 roundId,
            int256 feedPrice,
            ,
            uint256 feedUpdatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(feedPrice > 0, "Invalid price");
        require(answeredInRound >= roundId, "Incomplete round");

        return (feedPrice, feedUpdatedAt);
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
        require(_maxStaleness > 0, "Invalid staleness");
        MAX_STALENESS = _maxStaleness;
    }

    function _isStale(uint256 updatedAt) internal view returns (bool) {
        require(updatedAt > 0, "Incomplete round");
        require(updatedAt <= block.timestamp, "Invalid timestamp");
        return block.timestamp - updatedAt >= MAX_STALENESS;
    }

    function _requireFresh(uint256 updatedAt) internal view {
        require(updatedAt > 0, "Incomplete round");
        require(updatedAt <= block.timestamp, "Invalid timestamp");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");
    }
}
