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

/**
 * @title PriceOracle
 * @notice Secure price oracle with staleness check and fallback
 * @dev Fixes:
 *   - Added staleness check on updatedAt
 *   - Added price > 0 validation
 *   - Added round completeness check (answeredInRound >= roundId)
 *   - Added fallback oracle support
 *   - Added owner for configuration
 */
contract PriceOracle {
    AggregatorV3Interface public primaryFeed;
    AggregatorV3Interface public fallbackFeed;
    address public owner;
    uint256 public maxStaleness = 3600; // 1 hour default

    event PriceQueried(int256 price, uint256 timestamp);
    event FallbackUsed(int256 price, uint256 timestamp);

    constructor(address _primaryFeed, address _fallbackFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    /**
     * @notice Get latest price with full validation
     * @return price The validated price
     */
    function getLatestPrice() external view returns (int256) {
        return _getValidatedPrice(primaryFeed);
    }

    /**
     * @notice Get price with automatic fallback
     * @return price The validated price (from primary or fallback)
     */
    function getPriceWithFallback() external returns (int256) {
        try this.getLatestPrice() returns (int256 price) {
            emit PriceQueried(price, block.timestamp);
            return price;
        } catch {
            // Primary feed failed, use fallback
            int256 price = _getValidatedPrice(fallbackFeed);
            emit FallbackUsed(price, block.timestamp);
            return price;
        }
    }

    /**
     * @notice Internal function to get validated price from a feed
     * @param feed The oracle feed to query
     * @return price The validated price
     */
    function _getValidatedPrice(AggregatorV3Interface feed) internal view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        // Validate price is positive
        require(price > 0, "Invalid price: zero or negative");

        // Validate round is complete
        require(answeredInRound >= roundId, "Round incomplete");

        // Validate data is not stale
        require(block.timestamp - updatedAt < maxStaleness, "Price data stale");

        return price;
    }

    /**
     * @notice Get decimals from primary feed
     * @return decimals Number of decimals
     */
    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    /**
     * @notice Update max staleness (owner only)
     * @param _maxStaleness New max staleness in seconds
     */
    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        require(_maxStaleness > 0, "Invalid staleness");
        maxStaleness = _maxStaleness;
    }

    /**
     * @notice Update fallback feed (owner only)
     * @param _fallbackFeed New fallback feed address
     */
    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        require(_fallbackFeed != address(0), "Invalid fallback feed");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }
}
