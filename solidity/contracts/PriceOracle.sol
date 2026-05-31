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
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (int256 price, uint256 updatedAt) = _validatedPrice(primaryFeed);
        if (!_isStale(updatedAt)) {
            return price;
        }

        emit StalePrice(updatedAt);
        return _fallbackPrice();
    }

    function _fallbackPrice() internal view returns (int256) {
        require(address(fallbackFeed) != address(0), "Stale price");
        (int256 fallbackPrice, uint256 fallbackUpdatedAt) = _validatedPrice(fallbackFeed);
        require(!_isStale(fallbackUpdatedAt), "Stale price");
        return fallbackPrice;
    }

    function _validatedPrice(AggregatorV3Interface feed) internal view returns (int256 price, uint256 updatedAt) {
        (
            uint80 roundId,
            int256 latestPrice,
            ,
            uint256 latestUpdatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answeredInRound >= roundId, "Incomplete round");
        require(latestPrice > 0, "Invalid price");
        require(latestUpdatedAt <= block.timestamp, "Invalid timestamp");

        return (latestPrice, latestUpdatedAt);
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
