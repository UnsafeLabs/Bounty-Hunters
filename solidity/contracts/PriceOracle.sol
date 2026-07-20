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

/// @title PriceOracle with Chainlink validation + secondary fallback
/// @notice Rejects incomplete rounds and non-positive prices; falls back when primary is stale.
contract PriceOracle {
    AggregatorV3Interface public primaryFeed;
    AggregatorV3Interface public fallbackFeed;
    address public owner;
    uint256 public MAX_STALENESS = 3600;

    event PriceQueried(int256 price, uint256 timestamp);
    /// @param lastUpdate Primary feed `updatedAt` that failed the staleness check
    /// @param currentTime `block.timestamp` when fallback was triggered
    event StalePrice(uint256 lastUpdate, uint256 currentTime);

    constructor(address _primaryFeed, address _fallbackFeed) {
        require(_primaryFeed != address(0), "Invalid primary");
        require(_fallbackFeed != address(0), "Invalid fallback");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    /// @notice Latest validated price. Uses fallback if primary is stale.
    /// @dev Not `view` because a stale primary emits `StalePrice`.
    function getLatestPrice() external returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        require(answeredInRound >= roundId, "Incomplete round");
        require(price > 0, "Invalid price");

        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            emit StalePrice(updatedAt, block.timestamp);
            return _readValidated(fallbackFeed);
        }

        emit PriceQueried(price, block.timestamp);
        return price;
    }

    function _readValidated(AggregatorV3Interface feed) internal returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answeredInRound >= roundId, "Incomplete round");
        require(price > 0, "Invalid price");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");

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
        require(_fallbackFeed != address(0), "Invalid fallback");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }

    function setPrimaryFeed(address _primaryFeed) external {
        require(msg.sender == owner, "Not owner");
        require(_primaryFeed != address(0), "Invalid primary");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
    }
}
