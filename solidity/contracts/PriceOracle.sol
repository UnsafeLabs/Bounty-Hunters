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
    event StalePrice(uint256 lastUpdate, address feed);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }

    function getLatestPrice() external view returns (int256) {
        int256 price;
        bool stale = false;
        address feedAddr = address(primaryFeed);

        (price, stale, feedAddr) = _getPriceFromFeed(primaryFeed, feedAddr);

        // Fallback to secondary oracle if primary returned stale data
        if (stale && address(fallbackFeed) != address(0)) {
            (price, stale, feedAddr) = _getPriceFromFeed(fallbackFeed, feedAddr);
        }

        // If still stale and fallback exists, revert — both oracles stale
        if (stale && address(fallbackFeed) != address(0)) {
            revert("Both oracles returned stale data");
        }

        // If stale but no fallback configured, revert
        if (stale) {
            revert("Stale price and no fallback configured");
        }

        emit PriceQueried(price, block.timestamp);
        return price;
    }

    function _getPriceFromFeed(AggregatorV3Interface feed, address previousFeedAddr)
        internal view returns (int256 price, bool stale, address feedAddr)
    {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answer > 0, "Invalid price: zero or negative");
        require(answeredInRound >= roundId, "Incomplete round");

        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            stale = true;
            feedAddr = previousFeedAddr;
            emit StalePrice(updatedAt, address(feed));
        } else {
            stale = false;
            feedAddr = address(feed);
            price = answer;
        }
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
