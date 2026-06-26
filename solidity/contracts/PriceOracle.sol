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
    event FallbackUsed(int256 price, uint256 timestamp);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function getLatestPrice() external view returns (int256) {
        (int256 price, , bool valid) = _queryFeed(primaryFeed);
        if (!valid && address(fallbackFeed) != address(0)) {
            (price, , ) = _queryFeed(fallbackFeed);
            return price;
        }
        return price;
    }

    function _queryFeed(AggregatorV3Interface feed) private view returns (int256 price, uint256 updatedAt, bool valid) {
        (
            uint80 roundId,
            int256 price_,
            ,
            uint256 updatedAt_,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        if (price_ <= 0) return (0, 0, false);
        if (answeredInRound < roundId) return (0, 0, false);
        if (block.timestamp - updatedAt_ > MAX_STALENESS) return (0, 0, false);

        return (price_, updatedAt_, true);
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setFallbackFeed(address _fallbackFeed) external onlyOwner {
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        MAX_STALENESS = _maxStaleness;
    }
}
