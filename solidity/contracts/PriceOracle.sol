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
 * @notice Secure price oracle with staleness check and fallback
 * @dev Fixes:
 *   - Added staleness check on updatedAt
 *   - Added price > 0 validation
 *   - Added round completeness check (answeredInRound >= roundId)
 *   - Added fallback oracle support
 *   - Added Ownable access control
 */
contract PriceOracle is Ownable {
    AggregatorV3Interface public primaryFeed;
    AggregatorV3Interface public fallbackFeed;
    uint256 public maxStaleness = 3600;
    bool public useFallback;

    event PriceQueried(int256 price, uint256 timestamp, bool isFallback);
    event FallbackToggled(bool useFallback);

    constructor(address _primaryFeed, address _fallbackFeed) Ownable(msg.sender) {
        require(_primaryFeed != address(0), "Invalid primary feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        if (_fallbackFeed != address(0)) {
            fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        }
    }

    /**
     * @notice Get latest price with full validation
     * @return price The validated price
     */
    function getLatestPrice() external view returns (int256 price) {
        if (useFallback && address(fallbackFeed) != address(0)) {
            price = _getPriceFromFeed(fallbackFeed);
        } else {
            price = _getPriceFromFeed(primaryFeed);
        }
        
        emit PriceQueried(price, block.timestamp, useFallback);
        return price;
    }

    /**
     * @notice Get price from a specific feed with validation
     * @param feed The Chainlink feed to query
     * @return price The validated price
     */
    function _getPriceFromFeed(AggregatorV3Interface feed) internal view returns (int256 price) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        // Critical: Check price is positive
        require(answer > 0, "Invalid price: zero or negative");
        
        // Critical: Check round completeness
        require(answeredInRound >= roundId, "Stale round");
        
        // Critical: Check staleness
        require(block.timestamp - updatedAt < maxStaleness, "Price data stale");

        return answer;
    }

    /**
     * @notice Get price with fallback on primary failure
     * @return price The price from primary or fallback
     */
    function getPriceWithFallback() external view returns (int256 price) {
        try this.getLatestPrice() returns (int256 result) {
            return result;
        } catch {
            // Primary failed, try fallback
            if (address(fallbackFeed) != address(0)) {
                price = _getPriceFromFeed(fallbackFeed);
                emit PriceQueried(price, block.timestamp, true);
                return price;
            }
            revert("Both oracles failed");
        }
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Invalid staleness");
        maxStaleness = _maxStaleness;
    }

    function setUseFallback(bool _useFallback) external onlyOwner {
        require(address(fallbackFeed) != address(0), "No fallback configured");
        useFallback = _useFallback;
        emit FallbackToggled(_useFallback);
    }
}
