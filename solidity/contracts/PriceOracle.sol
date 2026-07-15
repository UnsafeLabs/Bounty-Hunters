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
    event FallbackUsed(address indexed feed, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function getLatestPrice() public view returns (int256) {
        // Try primary feed with full validation
        (uint80 roundId, int256 price, , uint256 updatedAt, uint80 answeredInRound) = primaryFeed.latestRoundData();

        if (price > 0 && answeredInRound >= roundId && block.timestamp - updatedAt < MAX_STALENESS) {
            return price;
        }

        // Fallback to secondary feed
        if (address(fallbackFeed) != address(0)) {
            (uint80 fallbackRoundId, int256 fallbackPrice, , uint256 fallbackUpdatedAt, uint80 fallbackAnsweredInRound) = fallbackFeed.latestRoundData();

            require(fallbackPrice > 0, "Fallback price is zero or negative");
            require(fallbackAnsweredInRound >= fallbackRoundId, "Fallback round not complete");
            require(block.timestamp - fallbackUpdatedAt < MAX_STALENESS, "Fallback price is stale");

            return fallbackPrice;
        }

        revert("Oracle: no valid price available");
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        MAX_STALENESS = _maxStaleness;
    }

    function setFallbackFeed(address _fallbackFeed) external onlyOwner {
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }
}
