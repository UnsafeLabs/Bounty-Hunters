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
    event StalePrice(uint256 timestamp);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            (
                uint80 fbRoundId,
                int256 fbPrice,
                ,
                uint256 fbUpdatedAt,
                uint80 fbAnsweredInRound
            ) = fallbackFeed.latestRoundData();

            require(block.timestamp - fbUpdatedAt < MAX_STALENESS, "Stale price");
            require(fbPrice > 0, "Invalid price");
            require(fbAnsweredInRound >= fbRoundId, "Incomplete round");

            return fbPrice;
        }

        require(price > 0, "Invalid price");
        require(answeredInRound >= roundId, "Incomplete round");

        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        MAX_STALENESS = _maxStaleness;
    }
}
