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
    event StalePrice(uint256 lastUpdateTimestamp);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function setFallbackOracle(address _fallback) external {
        require(msg.sender == owner, "Not owner");
        fallbackFeed = AggregatorV3Interface(_fallback);
    }

    function getLatestPrice() external returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        bool isPrimaryStale = block.timestamp - updatedAt >= MAX_STALENESS;
        bool isPrimaryValid = price > 0 && answeredInRound >= roundId && !isPrimaryStale;

        if (!isPrimaryValid) {
            emit StalePrice(updatedAt);
            
            require(address(fallbackFeed) != address(0), "No fallback oracle configured");
            
            (
                uint80 fbRoundId,
                int256 fbPrice,
                ,
                uint256 fbUpdatedAt,
                uint80 fbAnsweredInRound
            ) = fallbackFeed.latestRoundData();
            
            require(fbPrice > 0, "Invalid fallback price");
            require(fbAnsweredInRound >= fbRoundId, "Incomplete fallback round");
            require(block.timestamp - fbUpdatedAt < MAX_STALENESS, "Fallback oracle also stale");
            
            emit PriceQueried(fbPrice, fbUpdatedAt);
            return fbPrice;
        }

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
}
