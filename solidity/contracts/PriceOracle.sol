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
    event StalePrice(address feed, uint256 updatedAt);
    event FallbackUsed(address fallbackFeed, int256 price);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256) {
        (int256 price, uint256 updatedAt) = _getPriceFromFeed(primaryFeed);
        if (price > 0 && !_isStale(updatedAt)) {
            return price;
        }

        emit StalePrice(address(primaryFeed), updatedAt);

        (int256 fallbackPrice,) = _getPriceFromFeed(fallbackFeed);
        emit FallbackUsed(address(fallbackFeed), fallbackPrice);
        return fallbackPrice;
    }

    function _getPriceFromFeed(AggregatorV3Interface feed) internal view returns (int256 price, uint256 updatedAt) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 _updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answer > 0, "Invalid price");
        require(answeredInRound >= roundId, "Round not complete");

        return (answer, _updatedAt);
    }

    function _isStale(uint256 updatedAt) internal view returns (bool) {
        return block.timestamp - updatedAt >= MAX_STALENESS;
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
