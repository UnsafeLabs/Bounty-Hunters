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
    event StalePrice(address indexed feed, uint256 updatedAt);
    event FallbackFeedUpdated(address indexed fallbackFeed);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _primaryFeed, address _fallbackFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed");
        require(_fallbackFeed != address(0), "Invalid fallback feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (int256 primaryPrice, uint256 primaryUpdatedAt) = _validatedPrice(primaryFeed);
        if (_isFresh(primaryUpdatedAt)) {
            emit PriceQueried(primaryPrice, primaryUpdatedAt);
            return primaryPrice;
        }

        emit StalePrice(address(primaryFeed), primaryUpdatedAt);

        (int256 fallbackPrice, uint256 fallbackUpdatedAt) = _validatedPrice(fallbackFeed);
        require(_isFresh(fallbackUpdatedAt), "Stale price");
        emit PriceQueried(fallbackPrice, fallbackUpdatedAt);
        return fallbackPrice;
    }

    function _validatedPrice(
        AggregatorV3Interface feed
    ) private view returns (int256 price, uint256 updatedAt) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 feedUpdatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answer > 0, "Invalid price");
        require(answeredInRound >= roundId, "Incomplete round");
        require(feedUpdatedAt > 0, "Invalid timestamp");

        return (answer, feedUpdatedAt);
    }

    function _isFresh(uint256 updatedAt) private view returns (bool) {
        if (updatedAt > block.timestamp) {
            return false;
        }
        return block.timestamp - updatedAt < MAX_STALENESS;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setFallbackFeed(address _fallbackFeed) external onlyOwner {
        require(_fallbackFeed != address(0), "Invalid fallback feed");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        emit FallbackFeedUpdated(_fallbackFeed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Invalid staleness");
        MAX_STALENESS = _maxStaleness;
    }
}
