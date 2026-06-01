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

/**
 * @title PriceOracle
 * @notice Robust Chainlink price oracle with staleness checks and fallback
 * @dev Fixes:
 *   - Staleness check: reverts if price data is older than MAX_STALENESS
 *   - Positive price validation: reverts on zero or negative prices
 *   - Round completeness: ensures answeredInRound >= roundId
 *   - Fallback oracle: automatic failover to secondary feed
 *   - OpenZeppelin Ownable for standardized access control
 */
contract PriceOracle is Ownable {
    AggregatorV3Interface public primaryFeed;
    AggregatorV3Interface public fallbackFeed;
    uint256 public maxStaleness;

    event PriceQueried(address indexed feed, int256 price, uint256 updatedAt);
    event FallbackTriggered(address indexed primaryFeed, address indexed fallbackFeed);
    event MaxStalenessUpdated(uint256 oldValue, uint256 newValue);

    constructor(address _primaryFeed, address _fallbackFeed) Ownable(msg.sender) {
        require(_primaryFeed != address(0), "Invalid primary feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed); // can be address(0)
        maxStaleness = 3600; // 1 hour default
    }

    /**
     * @notice Get latest price with full validation
     * @dev Falls back to secondary oracle if primary is stale
     * @return price The latest valid price
     */
    function getLatestPrice() external view returns (int256) {
        // Try primary feed first
        (bool primaryValid, int256 primaryPrice, uint256 primaryUpdatedAt) = _queryFeed(primaryFeed);

        if (primaryValid) {
            emit PriceQueried(address(primaryFeed), primaryPrice, primaryUpdatedAt);
            return primaryPrice;
        }

        // Primary failed — try fallback
        if (address(fallbackFeed) != address(0)) {
            (bool fallbackValid, int256 fallbackPrice, uint256 fallbackUpdatedAt) = _queryFeed(fallbackFeed);
            if (fallbackValid) {
                emit PriceQueried(address(fallbackFeed), fallbackPrice, fallbackUpdatedAt);
                return fallbackPrice;
            }
        }

        revert("PriceOracle: no valid price source");
    }

    /**
     * @notice Query a Chainlink feed with all safety checks
     * @return valid Whether the feed returned a valid price
     * @return price The price from the feed
     * @return updatedAt The timestamp when the price was last updated
     */
    function _queryFeed(AggregatorV3Interface feed) internal view returns (bool valid, int256 price, uint256 updatedAt) {
        try feed.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            ,
            uint256 _updatedAt,
            uint80 answeredInRound
        ) {
            // Check 1: Price must be positive
            if (answer <= 0) return (false, 0, 0);

            // Check 2: Round must be complete (answeredInRound >= roundId)
            // Chainlink rounds complete when answeredInRound == roundId.
            // answeredInRound < roundId means data is from an incomplete round.
            if (answeredInRound < roundId) return (false, 0, 0);

            // Check 3: Data must not be stale
            if (block.timestamp - _updatedAt > maxStaleness) return (false, 0, 0);

            return (true, answer, _updatedAt);
        } catch {
            return (false, 0, 0);
        }
    }

    /**
     * @notice Check if primary feed is healthy
     */
    function isPrimaryHealthy() external view returns (bool) {
        (bool valid, , ) = _queryFeed(primaryFeed);
        return valid;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    /**
     * @notice Set max staleness in seconds
     */
    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Staleness must be > 0");
        uint256 oldValue = maxStaleness;
        maxStaleness = _maxStaleness;
        emit MaxStalenessUpdated(oldValue, _maxStaleness);
    }

    /**
     * @notice Set fallback oracle address
     */
    function setFallbackFeed(address _fallbackFeed) external onlyOwner {
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }
}
