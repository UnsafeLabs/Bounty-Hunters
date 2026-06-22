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
    event StalePrice(uint256 primaryUpdatedAt, uint256 fallbackUpdatedAt);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (uint80 roundId, int256 price, , uint256 updatedAt, uint80 answeredInRound) = primaryFeed.latestRoundData();

        require(price > 0, "Invalid price");
        require(answeredInRound >= roundId, "Round incomplete");

        if (block.timestamp - updatedAt < MAX_STALENESS) {
            emit PriceQueried(price, updatedAt);
            return price;
        }

        // Primary is stale — try fallback
        if (address(fallbackFeed) == address(0)) {
            revert("Stale price");
        }

        (uint80 fbRoundId, int256 fbPrice, , uint256 fbUpdatedAt, uint80 fbAnsweredInRound) = fallbackFeed.latestRoundData();
        require(fbPrice > 0, "Fallback invalid price");
        require(fbAnsweredInRound >= fbRoundId, "Fallback round incomplete");

        if (block.timestamp - fbUpdatedAt < MAX_STALENESS) {
            emit StalePrice(updatedAt, fbUpdatedAt);
            emit PriceQueried(fbPrice, fbUpdatedAt);
            return fbPrice;
        }

        revert("Stale price");
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
