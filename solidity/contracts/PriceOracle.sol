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

    function getLatestPrice() external returns (int256) {
        FeedResult memory primary = _readFeed(primaryFeed);
        _validateRound(primary);

        if (_isFresh(primary.updatedAt)) {
            emit PriceQueried(primary.price, primary.updatedAt);
            return primary.price;
        }

        require(address(fallbackFeed) != address(0), "Stale price");
        emit StalePrice(address(primaryFeed), primary.updatedAt);

        FeedResult memory fallbackResult = _readFeed(fallbackFeed);
        _validateRound(fallbackResult);
        require(_isFresh(fallbackResult.updatedAt), "Stale price");

        emit PriceQueried(fallbackResult.price, fallbackResult.updatedAt);
        return fallbackResult.price;
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
        emit MaxStalenessUpdated(_maxStaleness);
    }

    struct FeedResult {
        uint80 roundId;
        int256 price;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    function _readFeed(AggregatorV3Interface feed) internal view returns (FeedResult memory) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        return FeedResult({
            roundId: roundId,
            price: price,
            updatedAt: updatedAt,
            answeredInRound: answeredInRound
        });
    }

    function _validateRound(FeedResult memory result) internal pure {
        require(result.price > 0, "Invalid price");
        require(result.answeredInRound >= result.roundId, "Incomplete round");
    }

    function _isFresh(uint256 updatedAt) internal view returns (bool) {
        return updatedAt != 0 && updatedAt <= block.timestamp && block.timestamp - updatedAt < MAX_STALENESS;
    }
}
