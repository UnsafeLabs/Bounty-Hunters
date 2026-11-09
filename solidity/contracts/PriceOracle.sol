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
    event StalePrice(address indexed primaryOracle, uint256 updatedAt, uint256 currentTime);
    event FallbackFeedUpdated(address indexed fallbackFeed);

    constructor(address _primaryFeed, address _fallbackFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed address");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        if (_fallbackFeed != address(0)) {
            fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        }
        owner = msg.sender;
    }

    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        emit FallbackFeedUpdated(_fallbackFeed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }

    /// @notice Fetches the latest price from primary feed; falls back to secondary if primary is stale
    /// @return Validated price from primary or fallback feed
    function getLatestPrice() external returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        // Validation against invalid or incomplete round data
        require(price > 0, "Invalid price");
        require(answeredInRound >= roundId, "Round incomplete");

        // Check if primary oracle data is stale
        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            require(address(fallbackFeed) != address(0), "Stale price and no fallback configured");
            emit StalePrice(address(primaryFeed), updatedAt, block.timestamp);

            (
                uint80 fRoundId,
                int256 fPrice,
                ,
                uint256 fUpdatedAt,
                uint80 fAnsweredInRound
            ) = fallbackFeed.latestRoundData();

            require(fPrice > 0, "Invalid price");
            require(fAnsweredInRound >= fRoundId, "Round incomplete");
            require(block.timestamp - fUpdatedAt < MAX_STALENESS, "Stale price");

            emit PriceQueried(fPrice, block.timestamp);
            return fPrice;
        }

        emit PriceQueried(price, block.timestamp);
        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }
}
