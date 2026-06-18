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
    event FallbackFeedUpdated(address indexed fallbackFeed);
    event MaxStalenessUpdated(uint256 maxStaleness);

    constructor(address _primaryFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function _readValidPrice(AggregatorV3Interface feed) internal view returns (int256 price, uint256 updatedAt) {
        (
            uint80 roundId,
            int256 feedPrice,
            ,
            uint256 feedUpdatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answeredInRound >= roundId, "Incomplete round");
        require(feedPrice > 0, "Invalid price");
        require(feedUpdatedAt > 0 && feedUpdatedAt <= block.timestamp, "Invalid timestamp");

        return (feedPrice, feedUpdatedAt);
    }

    function _isFresh(uint256 updatedAt) internal view returns (bool) {
        return block.timestamp - updatedAt < MAX_STALENESS;
    }

    function getLatestPrice() external returns (int256) {
        (int256 price, uint256 updatedAt) = _readValidPrice(primaryFeed);
        if (_isFresh(updatedAt)) {
            emit PriceQueried(price, updatedAt);
            return price;
        }

        emit StalePrice(updatedAt);
        require(address(fallbackFeed) != address(0), "Fallback not set");

        (price, updatedAt) = _readValidPrice(fallbackFeed);
        require(_isFresh(updatedAt), "Stale price");
        emit PriceQueried(price, updatedAt);
        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setFallbackFeed(address _fallbackFeed) external onlyOwner {
        require(_fallbackFeed != address(0), "Invalid fallback feed");
        require(
            AggregatorV3Interface(_fallbackFeed).decimals() == primaryFeed.decimals(),
            "Decimals mismatch"
        );
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        emit FallbackFeedUpdated(_fallbackFeed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Invalid staleness");
        MAX_STALENESS = _maxStaleness;
        emit MaxStalenessUpdated(_maxStaleness);
    }
}
