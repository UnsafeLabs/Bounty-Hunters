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
    event FallbackUsed(uint256 timestamp);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
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

        require(price > 0, "Invalid price: zero or negative");
        require(answeredInRound >= roundId, "Incomplete round");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Price stale");

        return price;
    }

    function getLatestPriceWithFallback() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        bool primaryValid = price > 0 &&
            answeredInRound >= roundId &&
            block.timestamp - updatedAt < MAX_STALENESS;

        if (primaryValid) {
            return price;
        }

        require(address(fallbackFeed) != address(0), "No fallback oracle");

        (
            uint80 fbRoundId,
            int256 fbPrice,
            ,
            uint256 fbUpdatedAt,
            uint80 fbAnsweredInRound
        ) = fallbackFeed.latestRoundData();

        require(fbPrice > 0, "Fallback: invalid price");
        require(fbAnsweredInRound >= fbRoundId, "Fallback: incomplete round");
        require(block.timestamp - fbUpdatedAt < MAX_STALENESS, "Fallback: price stale");

        return fbPrice;
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
