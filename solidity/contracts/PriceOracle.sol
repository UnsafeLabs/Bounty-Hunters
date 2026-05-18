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
    event StalePrice(address indexed staleFeed, uint256 updatedAt);

    constructor(address _primaryFeed, address _fallbackFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed");
        require(_fallbackFeed != address(0), "Invalid fallback feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (int256 price, uint256 updatedAt, bool isStale) = _readFeed(primaryFeed);

        if (isStale) {
            emit StalePrice(address(primaryFeed), updatedAt);
            (price, , isStale) = _readFeed(fallbackFeed);
            require(!isStale, "Stale price");
        }

        emit PriceQueried(price, block.timestamp);
        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Invalid staleness");
        MAX_STALENESS = _maxStaleness;
    }

    function setFallbackFeed(address _fallbackFeed) external onlyOwner {
        require(_fallbackFeed != address(0), "Invalid fallback feed");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }

    function _readFeed(AggregatorV3Interface feed)
        internal
        view
        returns (int256 price, uint256 updatedAt, bool isStale)
    {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 feedUpdatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answer > 0, "Invalid price");
        require(answeredInRound >= roundId, "Incomplete round");
        require(feedUpdatedAt <= block.timestamp, "Invalid update time");

        return (answer, feedUpdatedAt, block.timestamp - feedUpdatedAt >= MAX_STALENESS);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
}
