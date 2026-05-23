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
    uint256 public MAX_STALENESS;

    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(address indexed oracle, uint256 lastUpdated);

    constructor(address _primaryFeed, address _fallbackFeed, uint256 _maxStaleness) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
        MAX_STALENESS = _maxStaleness > 0 ? _maxStaleness : 3600;
    }

    function getLatestPrice() external returns (int256) {
        (bool primaryOk, int256 primaryPrice, uint256 primaryUpdatedAt) = _fetchPrice(primaryFeed);

        if (primaryOk) {
            emit PriceQueried(primaryPrice, primaryUpdatedAt);
            return primaryPrice;
        }

        emit StalePrice(address(primaryFeed), primaryUpdatedAt);

        (bool fallbackOk, int256 fallbackPrice, uint256 fallbackUpdatedAt) = _fetchPrice(fallbackFeed);
        require(fallbackOk, "Both oracles returned stale or invalid data");

        emit PriceQueried(fallbackPrice, fallbackUpdatedAt);
        return fallbackPrice;
    }

    function _fetchPrice(AggregatorV3Interface feed)
        internal
        view
        returns (bool ok, int256 price, uint256 updatedAt)
    {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt_,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        if (answer <= 0) return (false, 0, updatedAt_);
        if (answeredInRound < roundId) return (false, 0, updatedAt_);
        if (block.timestamp - updatedAt_ >= MAX_STALENESS) return (false, 0, updatedAt_);

        return (true, answer, updatedAt_);
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        require(_maxStaleness > 0, "Staleness must be > 0");
        MAX_STALENESS = _maxStaleness;
    }
}
