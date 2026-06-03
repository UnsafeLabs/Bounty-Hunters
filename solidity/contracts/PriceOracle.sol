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
    uint256 public maxStaleness = 3600;

    event PriceQueried(int256 price, uint256 timestamp);
    event FallbackUsed(int256 price, uint256 timestamp);

    constructor(address _primaryFeed, address _fallbackFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256) {
        return _getValidatedPrice(primaryFeed);
    }

    function getPriceWithFallback() external returns (int256) {
        try this.getLatestPrice() returns (int256 price) {
            emit PriceQueried(price, block.timestamp);
            return price;
        } catch {
            int256 price = _getValidatedPrice(fallbackFeed);
            emit FallbackUsed(price, block.timestamp);
            return price;
        }
    }

    function _getValidatedPrice(AggregatorV3Interface feed) internal view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(price > 0, "Invalid price: zero or negative");
        require(answeredInRound >= roundId, "Round incomplete");
        require(block.timestamp - updatedAt < maxStaleness, "Price data stale");

        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        require(_maxStaleness > 0, "Invalid staleness");
        maxStaleness = _maxStaleness;
    }

    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        require(_fallbackFeed != address(0), "Invalid fallback feed");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }
}
