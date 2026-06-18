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
    event StalePrice(uint256 updatedAt);
    event FallbackFeedUpdated(address indexed fallbackFeed);
    event MaxStalenessUpdated(uint256 maxStaleness);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (
            int256 price,
            uint256 updatedAt,
            bool stale
        ) = _readAndValidate(primaryFeed, true);

        if (stale) {
            emit StalePrice(updatedAt);
            require(address(fallbackFeed) != address(0), "Stale price");
            (price, updatedAt, stale) = _readAndValidate(fallbackFeed, false);
            require(!stale, "Stale price");
        }

        emit PriceQueried(price, updatedAt);
        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        require(_maxStaleness > 0, "Invalid staleness");
        MAX_STALENESS = _maxStaleness;
        emit MaxStalenessUpdated(_maxStaleness);
    }

    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        require(_fallbackFeed != address(0), "Invalid fallback");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        emit FallbackFeedUpdated(_fallbackFeed);
    }

    function _readAndValidate(
        AggregatorV3Interface feed,
        bool allowStale
    ) internal view returns (int256 price, uint256 updatedAt, bool stale) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 feedUpdatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answer > 0, "Invalid price");
        require(answeredInRound >= roundId, "Incomplete round");
        require(feedUpdatedAt > 0 && feedUpdatedAt <= block.timestamp, "Invalid timestamp");

        uint256 age = block.timestamp - feedUpdatedAt;
        if (age > MAX_STALENESS) {
            require(allowStale, "Stale price");
            return (answer, feedUpdatedAt, true);
        }

        return (answer, feedUpdatedAt, false);
    }
}
