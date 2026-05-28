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
    event FallbackOracleUpdated(address indexed previousFeed, address indexed newFeed);
    event MaxStalenessUpdated(uint256 previousMaxStaleness, uint256 newMaxStaleness);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _primaryFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external returns (int256) {
        (int256 price, uint256 updatedAt, bool isStale) = _readValidatedPrice(primaryFeed);
        if (!isStale) {
            emit PriceQueried(price, updatedAt);
            return price;
        }

        emit StalePrice(address(primaryFeed), updatedAt);
        require(address(fallbackFeed) != address(0), "Stale price");

        (int256 fallbackPrice, uint256 fallbackUpdatedAt, bool fallbackIsStale) =
            _readValidatedPrice(fallbackFeed);
        require(!fallbackIsStale, "Stale price");

        emit PriceQueried(fallbackPrice, fallbackUpdatedAt);
        return fallbackPrice;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setFallbackFeed(address _fallbackFeed) external onlyOwner {
        require(_fallbackFeed != address(primaryFeed), "Invalid fallback feed");

        address previousFeed = address(fallbackFeed);
        if (_fallbackFeed == address(0)) {
            fallbackFeed = AggregatorV3Interface(address(0));
            emit FallbackOracleUpdated(previousFeed, address(0));
            return;
        }

        AggregatorV3Interface newFallbackFeed = AggregatorV3Interface(_fallbackFeed);
        require(newFallbackFeed.decimals() == primaryFeed.decimals(), "Decimals mismatch");
        fallbackFeed = newFallbackFeed;
        emit FallbackOracleUpdated(previousFeed, _fallbackFeed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Invalid staleness");
        uint256 previousMaxStaleness = MAX_STALENESS;
        MAX_STALENESS = _maxStaleness;
        emit MaxStalenessUpdated(previousMaxStaleness, _maxStaleness);
    }

    function _readValidatedPrice(
        AggregatorV3Interface feed
    ) internal view returns (int256, uint256, bool) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(answeredInRound >= roundId, "Incomplete round");
        require(price > 0, "Invalid price");
        require(updatedAt > 0 && updatedAt <= block.timestamp, "Invalid timestamp");

        return (price, updatedAt, block.timestamp - updatedAt > MAX_STALENESS);
    }
}
