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

    event PriceQueried(int256 price, uint256 timestamp, address feed);
    event StalePrice(address indexed feed, uint256 updatedAt, uint256 currentTime);
    event FallbackOracleSet(address indexed oldFallback, address indexed newFallback);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function setFallbackOracle(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        address old = address(fallbackFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        emit FallbackOracleSet(old, _fallbackFeed);
    }

    function _queryFeed(AggregatorV3Interface feed) internal view returns (int256, uint256, bool) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(price > 0, "Invalid price");
        require(answeredInRound >= roundId, "Incomplete round");

        bool isStale = block.timestamp - updatedAt >= MAX_STALENESS;
        return (price, updatedAt, isStale);
    }

    function getLatestPrice() external view returns (int256) {
        (int256 price, uint256 updatedAt, bool isStale) = _queryFeed(primaryFeed);

        if (isStale) {
            emit StalePrice(address(primaryFeed), updatedAt, block.timestamp);
            require(address(fallbackFeed) != address(0), "No fallback oracle set");

            (int256 fallbackPrice, uint256 fallbackUpdatedAt, bool fallbackStale) = _queryFeed(fallbackFeed);
            if (fallbackStale) {
                emit StalePrice(address(fallbackFeed), fallbackUpdatedAt, block.timestamp);
            }
            require(!fallbackStale, "Both oracles stale");

            emit PriceQueried(fallbackPrice, block.timestamp, address(fallbackFeed));
            return fallbackPrice;
        }

        emit PriceQueried(price, block.timestamp, address(primaryFeed));
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