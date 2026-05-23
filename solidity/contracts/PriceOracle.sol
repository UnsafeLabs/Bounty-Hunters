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

    constructor(address _primaryFeed, address _secondaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        secondaryFeed = AggregatorV3Interface(_secondaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (int256 price, ) = _queryFeedOrFallback();
        return price;
    }

    function _valid(int256 price, uint80 roundId, uint80 answeredInRound, uint256 updatedAt)
        private
        view
        returns (bool)
    {
        return answeredInRound >= roundId && price > 0 && block.timestamp - updatedAt < MAX_STALENESS;
    }

    function _queryFeedOrFallback() private returns (int256, uint256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        if (_valid(price, roundId, answeredInRound, updatedAt)) {
            return (price, updatedAt);
        }

        emit StalePrice(updatedAt);

        (
            uint80 fallbackRoundId,
            int256 fallbackPrice,
            ,
            uint256 fallbackUpdatedAt,
            uint80 fallbackAnsweredInRound
        ) = secondaryFeed.latestRoundData();

        require(
            _valid(fallbackPrice, fallbackRoundId, fallbackAnsweredInRound, fallbackUpdatedAt),
            "Both oracles stale"
        );

        return (fallbackPrice, fallbackUpdatedAt);
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
