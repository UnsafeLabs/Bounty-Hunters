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
    event FallbackFeedUpdated(address indexed oldFeed, address indexed newFeed);
    event MaxStalenessUpdated(uint256 oldMaxStaleness, uint256 newMaxStaleness);

    constructor(address _primaryFeed) {
        require(_primaryFeed != address(0), "Primary feed required");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256) {
        (bool primaryValid, int256 primaryPrice,) = _validatedPrice(primaryFeed);
        if (primaryValid) {
            return primaryPrice;
        }

        if (address(fallbackFeed) != address(0)) {
            (bool fallbackValid, int256 fallbackPrice,) = _validatedPrice(fallbackFeed);
            if (fallbackValid) {
                return fallbackPrice;
            }
        }

        revert("No valid oracle price");
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        require(_fallbackFeed != address(primaryFeed), "Fallback must differ");

        address oldFeed = address(fallbackFeed);
        if (_fallbackFeed == address(0)) {
            fallbackFeed = AggregatorV3Interface(address(0));
            emit FallbackFeedUpdated(oldFeed, address(0));
            return;
        }

        AggregatorV3Interface candidate = AggregatorV3Interface(_fallbackFeed);
        require(candidate.decimals() == primaryFeed.decimals(), "Decimals mismatch");
        fallbackFeed = candidate;
        emit FallbackFeedUpdated(oldFeed, _fallbackFeed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        require(_maxStaleness > 0, "Invalid staleness");
        uint256 oldMaxStaleness = MAX_STALENESS;
        MAX_STALENESS = _maxStaleness;
        emit MaxStalenessUpdated(oldMaxStaleness, _maxStaleness);
    }

    function _validatedPrice(
        AggregatorV3Interface feed
    ) internal view returns (bool, int256, uint256) {
        try feed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            uint256,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            if (
                roundId == 0 ||
                price <= 0 ||
                updatedAt == 0 ||
                updatedAt > block.timestamp ||
                answeredInRound < roundId ||
                block.timestamp - updatedAt > MAX_STALENESS
            ) {
                return (false, 0, updatedAt);
            }
            return (true, price, updatedAt);
        } catch {
            return (false, 0, 0);
        }
    }
}
