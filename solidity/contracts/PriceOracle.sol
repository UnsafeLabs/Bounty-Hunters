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
    event StalePrice(address indexed oracle, uint256 lastUpdateTimestamp);

    error InvalidPrice();
    error IncompleteRound();
    error StalePriceBothOracles();

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function _validateRound(
        uint80 roundId,
        int256 price,
        uint256 updatedAt,
        uint80 answeredInRound
    ) internal view {
        if (price <= 0) revert InvalidPrice();
        if (answeredInRound < roundId) revert IncompleteRound();
        if (block.timestamp - updatedAt >= MAX_STALENESS) revert StalePriceBothOracles();
    }

    function _fetchFromFeed(AggregatorV3Interface feed)
        internal
        returns (int256 price, uint256 updatedAt, bool stale)
    {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 _updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        // Check for invalid price or incomplete round first
        if (answer <= 0) revert InvalidPrice();
        if (answeredInRound < roundId) revert IncompleteRound();

        // Check staleness
        if (block.timestamp - _updatedAt >= MAX_STALENESS) {
            return (0, _updatedAt, true);
        }

        return (answer, _updatedAt, false);
    }

    function getLatestPrice() external returns (int256) {
        (int256 price, uint256 primaryUpdatedAt, bool stale) = _fetchFromFeed(primaryFeed);

        if (stale) {
            // Emit StalePrice for primary oracle before trying fallback
            emit StalePrice(address(primaryFeed), primaryUpdatedAt);

            // Try fallback oracle
            (int256 fallbackPrice, uint256 fallbackUpdatedAt, bool fallbackStale)
                = _fetchFromFeed(fallbackFeed);

            if (fallbackStale) {
                // Both oracles stale — emit for fallback too, then revert
                emit StalePrice(address(fallbackFeed), fallbackUpdatedAt);
                revert StalePriceBothOracles();
            }

            emit PriceQueried(fallbackPrice, block.timestamp);
            return fallbackPrice;
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
