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
    event StalePrice(address indexed feed, uint256 updatedAt, uint256 currentTime);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function setSecondaryFeed(address _secondaryFeed) external {
        require(msg.sender == owner, "Not owner");
        secondaryFeed = AggregatorV3Interface(_secondaryFeed);
    }

    function _validatePrice(
        uint80 roundId,
        int256 price,
        uint256 updatedAt,
        uint80 answeredInRound
    ) internal view returns (bool) {
        if (price <= 0) return false;
        if (answeredInRound < roundId) return false;
        if (block.timestamp - updatedAt >= MAX_STALENESS) return false;
        return true;
    }

    function getLatestPrice() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        // Validate primary feed
        if (_validatePrice(roundId, price, updatedAt, answeredInRound)) {
            return price;
        }

        // Primary is stale/invalid — emit event and try secondary
        emit StalePrice(address(primaryFeed), updatedAt, block.timestamp);

        // If no secondary feed set, revert with original validation errors
        require(address(secondaryFeed) != address(0), "Primary stale and no secondary feed");

        (
            uint80 secRoundId,
            int256 secPrice,
            ,
            uint256 secUpdatedAt,
            uint80 secAnsweredInRound
        ) = secondaryFeed.latestRoundData();

        require(secPrice > 0, "Invalid price");
        require(secAnsweredInRound >= secRoundId, "Incomplete round");
        require(block.timestamp - secUpdatedAt < MAX_STALENESS, "Stale price");

        return secPrice;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
