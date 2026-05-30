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
    event StalePrice(uint256 updatedAt);

    constructor(address _primaryFeed, address _fallbackFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed");
        require(_fallbackFeed != address(0), "Invalid fallback feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (int256 price, uint256 updatedAt) = _readValidatedPrice(primaryFeed);
        if (!_isStale(updatedAt)) {
            emit PriceQueried(price, updatedAt);
            return price;
        }

        emit StalePrice(updatedAt);

        (int256 fallbackPrice, uint256 fallbackUpdatedAt) = _readFreshPrice(fallbackFeed);
        emit PriceQueried(fallbackPrice, fallbackUpdatedAt);
        return fallbackPrice;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Invalid staleness");
        MAX_STALENESS = _maxStaleness;
    }

    function setPrimaryFeed(address _primaryFeed) external onlyOwner {
        require(_primaryFeed != address(0), "Invalid primary feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
    }

    function setFallbackFeed(address _fallbackFeed) external onlyOwner {
        require(_fallbackFeed != address(0), "Invalid fallback feed");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }

    function _readFreshPrice(
        AggregatorV3Interface feed
    ) internal view returns (int256 price, uint256 updatedAt) {
        (price, updatedAt) = _readValidatedPrice(feed);
        require(!_isStale(updatedAt), "Stale price");
    }

    function _readValidatedPrice(
        AggregatorV3Interface feed
    ) internal view returns (int256 price, uint256 updatedAt) {
        uint80 roundId;
        int256 answer;
        uint80 answeredInRound;
        (
            roundId,
            answer,
            ,
            updatedAt,
            answeredInRound
        ) = feed.latestRoundData();

        require(answeredInRound >= roundId, "Incomplete round");
        require(answer > 0, "Invalid price");
        require(updatedAt <= block.timestamp, "Invalid timestamp");
        return (answer, updatedAt);
    }

    function _isStale(uint256 updatedAt) internal view returns (bool) {
        return block.timestamp - updatedAt >= MAX_STALENESS;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
}
