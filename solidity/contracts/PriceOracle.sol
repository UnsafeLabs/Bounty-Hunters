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

    constructor(address _primaryFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function getLatestPrice() external returns (int256) {
        (int256 price, uint256 updatedAt, bool stale) = _readPrice(primaryFeed, true);
        if (!stale) {
            emit PriceQueried(price, updatedAt);
            return price;
        }

        require(address(fallbackFeed) != address(0), "Stale price");
        emit StalePrice(address(primaryFeed), updatedAt);

        (int256 fallbackPrice, uint256 fallbackUpdatedAt,) = _readPrice(fallbackFeed, false);
        emit PriceQueried(fallbackPrice, fallbackUpdatedAt);
        return fallbackPrice;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setFallbackFeed(address _fallbackFeed) external onlyOwner {
        require(_fallbackFeed != address(0), "Invalid fallback feed");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Invalid staleness");
        MAX_STALENESS = _maxStaleness;
    }

    function _readPrice(
        AggregatorV3Interface feed,
        bool allowStale
    ) internal view returns (int256 price, uint256 updatedAt, bool stale) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 lastUpdatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answeredInRound >= roundId, "Incomplete round");
        require(answer > 0, "Invalid price");

        bool isStale = block.timestamp - lastUpdatedAt >= MAX_STALENESS;
        if (!allowStale) {
            require(!isStale, "Stale price");
        }

        return (answer, lastUpdatedAt, isStale);
    }
}
