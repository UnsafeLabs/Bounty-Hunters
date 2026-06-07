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
    event StalePrice(address indexed oracle, uint256 updatedAt);
    event FallbackFeedUpdated(address indexed fallbackFeed);
    event MaxStalenessUpdated(uint256 maxStaleness);

    constructor(address _primaryFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed");

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
            emit StalePrice(address(primaryFeed), updatedAt);
            return _getFallbackPrice();
        }

        emit PriceQueried(price, updatedAt);
        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        require(_fallbackFeed != address(0), "Invalid fallback feed");

        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        emit FallbackFeedUpdated(_fallbackFeed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        require(_maxStaleness > 0, "Invalid staleness");

        MAX_STALENESS = _maxStaleness;
        emit MaxStalenessUpdated(_maxStaleness);
    }

    function _getFallbackPrice() internal returns (int256) {
        require(address(fallbackFeed) != address(0), "Fallback not set");

        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = fallbackFeed.latestRoundData();

        _validateRound(roundId, price, updatedAt, answeredInRound);
        require(!_isStale(updatedAt), "Stale price");

        emit PriceQueried(price, updatedAt);
        return price;
    }

    function _validateRound(
        uint80 roundId,
        int256 price,
        uint256 updatedAt,
        uint80 answeredInRound
    ) internal view {
        require(answeredInRound >= roundId, "Incomplete round");
        require(price > 0, "Invalid price");
        require(updatedAt > 0 && updatedAt <= block.timestamp, "Invalid timestamp");
    }

    function _isStale(uint256 updatedAt) internal view returns (bool) {
        return block.timestamp - updatedAt >= MAX_STALENESS;
    }
}
