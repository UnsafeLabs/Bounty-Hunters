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
    AggregatorV3Interface public secondaryFeed;
    address public owner;
    uint256 public MAX_STALENESS = 3600;

    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(uint256 primaryUpdatedAt);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    /// @notice Returns the latest price with staleness, round-completeness and
    /// positive-value validation. Falls back to the secondary feed when the
    /// primary feed returns stale data, emitting StalePrice with the primary's
    /// last update timestamp. Reverts when both feeds are stale or invalid.
    function getLatestPrice() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        if (_isValid(price, updatedAt, roundId, answeredInRound)) {
            emit PriceQueried(price, updatedAt);
            return price;
        }

        // Primary feed stale/invalid - try the fallback oracle.
        emit StalePrice(updatedAt);

        (
            uint80 secRoundId,
            int256 secPrice,
            ,
            uint256 secUpdatedAt,
            uint80 secAnsweredInRound
        ) = secondaryFeed.latestRoundData();

        require(
            _isValid(secPrice, secUpdatedAt, secRoundId, secAnsweredInRound),
            "Stale price"
        );

        emit PriceQueried(secPrice, secUpdatedAt);
        return secPrice;
    }

    function _isValid(
        int256 price,
        uint256 updatedAt,
        uint80 roundId,
        uint80 answeredInRound
    ) internal view returns (bool) {
        if (price <= 0) return false;
        if (answeredInRound < roundId) return false;
        if (block.timestamp - updatedAt >= MAX_STALENESS) return false;
        return true;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setSecondaryFeed(address _secondaryFeed) external onlyOwner {
        require(_secondaryFeed != address(0), "Invalid feed");
        secondaryFeed = AggregatorV3Interface(_secondaryFeed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Invalid staleness");
        MAX_STALENESS = _maxStaleness;
    }
}