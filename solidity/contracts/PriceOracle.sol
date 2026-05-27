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
    event StalePrice(address indexed primaryFeed, uint256 lastUpdateTimestamp);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    /// @notice Returns the latest price from the primary oracle.
    ///         Falls back to the secondary oracle if primary is stale.
    ///         Reverts if both oracles return stale data.
    function getLatestPrice() external returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        // Check round completeness
        require(answeredInRound >= roundId, "Incomplete round");

        // Check for negative or zero price
        require(price > 0, "Invalid price");

        // Check staleness (protect against updatedAt in the future)
        if (updatedAt <= block.timestamp && block.timestamp - updatedAt <= MAX_STALENESS) {
            emit PriceQueried(price, updatedAt, false);
            return price;
        }

        // Primary is stale — try fallback
        if (address(fallbackFeed) != address(0)) {
            emit StalePrice(address(primaryFeed), updatedAt);

            (
                uint80 fbRoundId,
                int256 fbPrice,
                ,
                uint256 fbUpdatedAt,
                uint80 fbAnsweredInRound
            ) = fallbackFeed.latestRoundData();

            require(fbAnsweredInRound >= fbRoundId, "Fallback: incomplete round");
            require(fbPrice > 0, "Fallback: invalid price");
            require(fbUpdatedAt <= block.timestamp && block.timestamp - fbUpdatedAt <= MAX_STALENESS, "Both oracles stale");

            emit PriceQueried(fbPrice, fbUpdatedAt, true);
            return fbPrice;
        }

        // No fallback available, primary is stale
        revert("Stale price");
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
