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

    constructor(address _primaryFeed, address _fallbackFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        if (_fallbackFeed != address(0)) {
            fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        }
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256) {
        (int256 price, uint256 updatedAt) = _tryGetPrice(primaryFeed);
        if (price > 0 && block.timestamp - updatedAt < MAX_STALENESS) {
            return price;
        }
        if (address(fallbackFeed) != address(0)) {
            (int256 fallbackPrice, uint256 fallbackUpdated) = _tryGetPrice(fallbackFeed);
            if (fallbackPrice > 0 && block.timestamp - fallbackUpdated < MAX_STALENESS) {
                return fallbackPrice;
            }
        }
        revert("Price unavailable");
    }

    function _tryGetPrice(AggregatorV3Interface feed) private view returns (int256 price, uint256 updatedAt) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 _updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();
        require(answeredInRound >= roundId, "Round incomplete");
        return (answer, _updatedAt);
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
