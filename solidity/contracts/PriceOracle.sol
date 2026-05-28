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
    uint256 public MAX_STALENESS = 3600; // 1 hour default

    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(address indexed primaryOracle, uint256 lastUpdateTimestamp, address indexed fallbackOracle);
    event FallbackOracleUpdated(address indexed oldFallback, address indexed newFallback);

    constructor(address _primaryFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed address");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    /// @notice Returns the latest price with staleness, validity, and round completeness checks.
    /// @dev Falls back to secondary oracle if primary is stale. Reverts if both are stale/invalid.
    function getLatestPrice() external view returns (int256) {
        (int256 price, bool primaryStale) = _readFeed(primaryFeed);

        if (!primaryStale) {
            return price;
        }

        // Primary is stale — try fallback
        require(address(secondaryFeed) != address(0), "No fallback oracle configured and primary is stale");
        emit StalePrice(address(primaryFeed), block.timestamp, address(secondaryFeed));

        (int256 fallbackPrice, bool fallbackStale) = _readFeed(secondaryFeed);
        require(!fallbackStale, "Both primary and fallback oracles returned stale data");

        return fallbackPrice;
    }

    /// @dev Reads a feed and validates the response. Returns (price, isStale).
    /// isStale is true if the data fails validation (stale, negative, incomplete round).
    function _readFeed(AggregatorV3Interface feed) private view returns (int256, bool) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        // Round completeness check
        if (answeredInRound < roundId) {
            return (0, true);
        }

        // Zero or negative price check
        if (price <= 0) {
            return (0, true);
        }

        // Staleness check
        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            return (0, true);
        }

        return (price, false);
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    /// @notice Sets the fallback oracle address.
    /// @dev Set to address(0) to disable fallback.
    function setFallbackOracle(address _fallbackOracle) external {
        require(msg.sender == owner, "Not owner");
        emit FallbackOracleUpdated(address(secondaryFeed), _fallbackOracle);
        secondaryFeed = AggregatorV3Interface(_fallbackOracle);
    }

    /// @notice Updates the maximum staleness threshold (in seconds).
    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }

    /// @notice Syncs internal reserves — no-op for price oracle but kept for interface compatibility.
    function sync() external pure {
        // No-op: PriceOracle does not maintain internal reserves
    }
}
