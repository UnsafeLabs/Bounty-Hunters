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
    event StalePrice(uint256 updatedAt, uint256 currentTime);

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

        bool isStale = block.timestamp - updatedAt >= MAX_STALENESS;
        bool isInvalid = price <= 0 || answeredInRound < roundId;

        // If primary is stale or invalid, try fallback
        if (isStale || isInvalid) {
            if (address(fallbackFeed) != address(0)) {
                return _getFallbackPrice(isStale);
            }
            // No fallback available — revert
            if (isStale) revert("Stale price");
            if (price <= 0) revert("Invalid price");
            if (answeredInRound < roundId) revert("Incomplete round");
        }

        return price;
    }

    function _getFallbackPrice(bool emitStaleEvent) internal view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = fallbackFeed.latestRoundData();

        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            revert("Both oracles stale");
        }
        if (price <= 0) revert("Invalid fallback price");
        if (answeredInRound < roundId) revert("Incomplete fallback round");

        // Note: StalePrice event cannot be emitted in a view function
        // Callers should check primary feed staleness separately if needed

        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
