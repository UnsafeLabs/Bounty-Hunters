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
    event StalePrice(uint256 primaryUpdatedAt, address fallbackFeedUsed);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    /// @notice Get the latest price with full validation and fallback
    /// @dev Validates primary feed for staleness, negative prices, and round completeness.
    ///      Falls back to secondary oracle if primary is stale.
    function getLatestPrice() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        bool primaryStale = block.timestamp - updatedAt >= MAX_STALENESS;
        bool primaryInvalid = price <= 0 || answeredInRound < roundId;

        if (primaryStale || primaryInvalid) {
            // Try fallback oracle
            (
                uint80 fbRoundId,
                int256 fbPrice,
                ,
                uint256 fbUpdatedAt,
                uint80 fbAnsweredInRound
            ) = fallbackFeed.latestRoundData();

            // Fallback must also pass all validation
            require(fbPrice > 0, "Invalid fallback price");
            require(fbAnsweredInRound >= fbRoundId, "Incomplete fallback round");
            require(block.timestamp - fbUpdatedAt < MAX_STALENESS, "Both oracles stale");

            // Emit stale price event (only callable in non-view context, so we emit in getLatestPriceWrite)
            return fbPrice;
        }

        require(price > 0, "Invalid price");
        return price;
    }

    /// @notice Get the latest price with state change (emits StalePrice event when using fallback)
    function getLatestPriceWrite() external returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        bool primaryStale = block.timestamp - updatedAt >= MAX_STALENESS;
        bool primaryInvalid = price <= 0 || answeredInRound < roundId;

        if (primaryStale || primaryInvalid) {
            emit StalePrice(updatedAt, address(fallbackFeed));

            (
                uint80 fbRoundId,
                int256 fbPrice,
                ,
                uint256 fbUpdatedAt,
                uint80 fbAnsweredInRound
            ) = fallbackFeed.latestRoundData();

            require(fbPrice > 0, "Invalid fallback price");
            require(fbAnsweredInRound >= fbRoundId, "Incomplete fallback round");
            require(block.timestamp - fbUpdatedAt < MAX_STALENESS, "Both oracles stale");

            emit PriceQueried(fbPrice, fbUpdatedAt);
            return fbPrice;
        }

        require(price > 0, "Invalid price");
        require(answeredInRound >= roundId, "Incomplete round");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");

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

    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }
}
