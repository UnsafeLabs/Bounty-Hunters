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
    event StalePrice(address indexed oracle, uint256 lastUpdateTimestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function _getPriceWithStaleness(AggregatorV3Interface feed) internal view returns (int256 price, uint256 updatedAt) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAtRaw,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answer > 0, "Invalid price");
        require(answeredInRound >= roundId, "Incomplete round");

        return (answer, updatedAtRaw);
    }

    function getLatestPrice() external view returns (int256) {
        (int256 primaryPrice, uint256 primaryUpdatedAt) = _getPriceWithStaleness(primaryFeed);

        if (block.timestamp - primaryUpdatedAt < MAX_STALENESS) {
            return primaryPrice;
        }

        // Primary is stale, emit event and try fallback
        emit StalePrice(address(primaryFeed), primaryUpdatedAt);

        (int256 fallbackPrice, uint256 fallbackUpdatedAt) = _getPriceWithStaleness(fallbackFeed);

        require(block.timestamp - fallbackUpdatedAt < MAX_STALENESS, "Both oracles stale");

        return fallbackPrice;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        MAX_STALENESS = _maxStaleness;
    }

    function setFallbackFeed(address _fallbackFeed) external onlyOwner {
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }
}
