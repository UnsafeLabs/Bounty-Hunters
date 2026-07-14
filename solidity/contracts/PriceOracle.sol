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
    event FallbackUsed(int256 primaryPrice, int256 fallbackPrice);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }

    function getLatestPrice() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        require(price > 0, "Invalid price: zero or negative");
        require(answeredInRound >= roundId, "Incomplete round");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");

        return price;
    }

    function getLatestPriceSafe() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        bool valid = price > 0
            && answeredInRound >= roundId
            && block.timestamp - updatedAt < MAX_STALENESS;

        if (valid) return price;

        if (address(fallbackFeed) != address(0)) {
            (
                uint80 fRoundId,
                int256 fPrice,
                ,
                uint256 fUpdatedAt,
                uint80 fAnsweredInRound
            ) = fallbackFeed.latestRoundData();

            require(fPrice > 0, "Fallback invalid price");
            require(fAnsweredInRound >= fRoundId, "Fallback incomplete round");
            require(block.timestamp - fUpdatedAt < MAX_STALENESS, "Fallback stale price");

            return fPrice;
        }

        revert("No valid price available");
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
