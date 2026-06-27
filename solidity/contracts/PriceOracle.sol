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
    event StalePrice(uint256 primaryUpdatedAt, address fallbackFeed);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    // FIX: Added staleness check, price validation, round completeness, and fallback oracle
    function getLatestPrice() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        // Check round completeness
        require(answeredInRound >= roundId, "Incomplete round");

        // Check for stale price
        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            // Try fallback oracle
            if (address(fallbackFeed) != address(0)) {
                (
                    uint80 fbRoundId,
                    int256 fbPrice,
                    ,
                    uint256 fbUpdatedAt,
                    uint80 fbAnsweredInRound
                ) = fallbackFeed.latestRoundData();

                require(fbAnsweredInRound >= fbRoundId, "Fallback: incomplete round");
                require(fbPrice > 0, "Fallback: invalid price");
                require(block.timestamp - fbUpdatedAt < MAX_STALENESS, "Both oracles stale");

                emit StalePrice(updatedAt, address(fallbackFeed));
                emit PriceQueried(fbPrice, fbUpdatedAt);
                return fbPrice;
            }
            revert("Stale price and no fallback");
        }

        // Validate price
        require(price > 0, "Invalid price");

        emit PriceQueried(price, updatedAt);
        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }

    // FIX: Added setter for fallback oracle
    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }
}
