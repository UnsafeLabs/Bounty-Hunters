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

    event PriceQueried(int256 price, uint256 timestamp, bool usedFallback);

    constructor(address _primaryFeed, address _fallbackFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        if (_fallbackFeed != address(0)) {
            fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        }
        owner = msg.sender;
    }

    // FIX: Full validation — staleness, negative price, round completeness, fallback
    function getLatestPrice() external view returns (int256) {
        (bool primaryOk, int256 primaryPrice) = _getPrice(primaryFeed);
        if (primaryOk) {
            emit PriceQueried(primaryPrice, block.timestamp, false);
            return primaryPrice;
        }

        // FIX: Try fallback oracle if primary fails
        if (address(fallbackFeed) != address(0)) {
            (bool fallbackOk, int256 fallbackPrice) = _getPrice(fallbackFeed);
            if (fallbackOk) {
                emit PriceQueried(fallbackPrice, block.timestamp, true);
                return fallbackPrice;
            }
        }

        revert("All price feeds unavailable or stale");
    }

    function _getPrice(AggregatorV3Interface feed) internal view returns (bool ok, int256 price) {
        try feed.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // FIX: Check price is positive
            if (answer <= 0) return (false, 0);
            // FIX: Check round is complete (answeredInRound >= roundId)
            if (answeredInRound < roundId) return (false, 0);
            // FIX: Check staleness
            if (block.timestamp - updatedAt > MAX_STALENESS) return (false, 0);
            return (true, answer);
        } catch {
            return (false, 0);
        }
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        require(_maxStaleness > 0, "Staleness must be > 0");
        MAX_STALENESS = _maxStaleness;
    }

    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }
}
