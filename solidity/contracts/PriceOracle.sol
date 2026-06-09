// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

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

contract PriceOracle is Ownable {
    AggregatorV3Interface public primaryFeed;
    AggregatorV3Interface public fallbackFeed;
    uint256 public MAX_STALENESS = 3600;

    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(uint256 lastUpdatedAt);

    constructor(address _primaryFeed, address _fallbackFeed) Ownable(msg.sender) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }

    function getLatestPrice() external returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        require(price > 0, "Invalid price");
        require(answeredInRound >= roundId, "Incomplete round");

        if (block.timestamp - updatedAt < MAX_STALENESS) {
            emit PriceQueried(price, block.timestamp);
            return price;
        }

        // Primary is stale, fallback to secondary
        emit StalePrice(updatedAt);

        (
            uint80 fRoundId,
            int256 fPrice,
            ,
            uint256 fUpdatedAt,
            uint80 fAnsweredInRound
        ) = fallbackFeed.latestRoundData();

        require(fPrice > 0, "Invalid fallback price");
        require(fAnsweredInRound >= fRoundId, "Incomplete fallback round");
        require(block.timestamp - fUpdatedAt < MAX_STALENESS, "Stale price");

        emit PriceQueried(fPrice, block.timestamp);
        return fPrice;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        MAX_STALENESS = _maxStaleness;
    }

    function setFeeds(address _primaryFeed, address _fallbackFeed) external onlyOwner {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }
}
