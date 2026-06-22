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
    event StalePrice(uint256 primaryUpdatedAt, uint256 currentTimestamp);

    error InvalidPrice();
    error IncompleteRound();
    error BothOraclesStale();

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    /// @notice Returns the latest price from the primary oracle, falling back to the secondary if stale
    /// @return The validated price from the oracle
    function getLatestPrice() external returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        // Validate round completeness
        if (answeredInRound < roundId) {
            // Try fallback
            return _getFallbackPrice(updatedAt);
        }

        // Validate price is positive
        if (price <= 0) {
            revert InvalidPrice();
        }

        // Validate staleness
        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            return _getFallbackPrice(updatedAt);
        }

        emit PriceQueried(price, block.timestamp);
        return price;
    }

    /// @notice Returns the latest price from the primary oracle (view function for reads)
    /// @return The validated price from the oracle
    function getLatestPriceView() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        // Validate round completeness
        require(answeredInRound >= roundId, "Incomplete round");

        // Validate price is positive
        require(price > 0, "Invalid price");

        // Validate staleness
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");

        return price;
    }

    /// @notice Internal function to get price from fallback oracle
    function _getFallbackPrice(uint256 primaryUpdatedAt) internal returns (int256) {
        emit StalePrice(primaryUpdatedAt, block.timestamp);

        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = fallbackFeed.latestRoundData();

        // Validate fallback round completeness
        if (answeredInRound < roundId) {
            revert BothOraclesStale();
        }

        // Validate fallback price is positive
        if (price <= 0) {
            revert InvalidPrice();
        }

        // Validate fallback staleness
        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            revert BothOraclesStale();
        }

        emit PriceQueried(price, block.timestamp);
        return price;
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
