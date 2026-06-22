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

/// @title PriceOracle with staleness check and fallback mechanism
/// @notice Fixes missing staleness check and adds fallback oracle support
contract PriceOracle {
    AggregatorV3Interface public primaryFeed;
    AggregatorV3Interface public fallbackFeed;
    address public owner;
    uint256 public MAX_STALENESS = 3600;

    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(uint256 updatedAt, address fallbackUsed);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    // FIX: Add staleness check, round completeness validation, and negative price check
    // FIX: Add fallback oracle when primary returns stale data
    function getLatestPrice() external view returns (int256) {
        // Try primary oracle first
        (
            uint80 primaryRoundId,
            int256 primaryPrice,
            ,
            uint256 primaryUpdatedAt,
            uint80 primaryAnsweredInRound
        ) = primaryFeed.latestRoundData();

        // Validate primary: round completeness
        require(primaryAnsweredInRound >= primaryRoundId, "Incomplete round");
        // Validate primary: positive price
        require(primaryPrice > 0, "Invalid price");
        // Validate primary: staleness check
        bool isPrimaryStale = (block.timestamp - primaryUpdatedAt >= MAX_STALENESS);

        if (isPrimaryStale) {
            // Fallback to secondary oracle
            (
                uint80 fallbackRoundId,
                int256 fallbackPrice,
                ,
                uint256 fallbackUpdatedAt,
                uint80 fallbackAnsweredInRound
            ) = fallbackFeed.latestRoundData();

            // Validate fallback: round completeness
            require(fallbackAnsweredInRound >= fallbackRoundId, "Fallback incomplete round");
            // Validate fallback: positive price
            require(fallbackPrice > 0, "Fallback invalid price");
            // Validate fallback: staleness check
            require(block.timestamp - fallbackUpdatedAt < MAX_STALENESS, "Fallback stale price");

            emit StalePrice(primaryUpdatedAt, address(this));
            return fallbackPrice;
        }

        emit PriceQueried(primaryPrice, primaryUpdatedAt);
        return primaryPrice;
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
