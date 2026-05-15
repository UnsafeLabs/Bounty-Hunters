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
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        _validateRound(roundId, price, updatedAt, answeredInRound);

        if (_isStale(updatedAt)) {
            require(address(fallbackFeed) != address(0), "Fallback not set");
            emit StalePrice(address(primaryFeed), updatedAt);
            (price, updatedAt) = _getValidatedPrice(fallbackFeed);
        }

        emit PriceQueried(price, updatedAt);

        return price;
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

    function _getValidatedPrice(AggregatorV3Interface feed) internal view returns (int256, uint256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        _validateRound(roundId, price, updatedAt, answeredInRound);
        require(!_isStale(updatedAt), "Stale price");

        return (price, updatedAt);
    }

    function _validateRound(
        uint80 roundId,
        int256 price,
        uint256 updatedAt,
        uint80 answeredInRound
    ) internal view {
        require(answeredInRound >= roundId, "Incomplete round");
        require(price > 0, "Invalid price");
        require(updatedAt <= block.timestamp, "Invalid timestamp");
    }

    function _isStale(uint256 updatedAt) internal view returns (bool) {
        return block.timestamp - updatedAt >= MAX_STALENESS;
    }
}
