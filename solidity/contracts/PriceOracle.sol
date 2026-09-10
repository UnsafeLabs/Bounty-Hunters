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

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    // FIX: Added staleness check on updatedAt.
    // FIX: Added check for negative/zero price.
    // FIX: Added round completeness validation.
    // FIX: Added fallback oracle support.
    function getLatestPrice() external view returns (int256) {
        try primaryFeed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            uint256,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            _validatePriceData(roundId, price, updatedAt, answeredInRound);
            return price;
        } catch {
            return _getFallbackPrice();
        }
    }

    function _validatePriceData(
        uint80 roundId,
        int256 price,
        uint256 updatedAt,
        uint80 answeredInRound
    ) internal view {
        require(price > 0, "Price must be positive");
        require(answeredInRound >= roundId, "Round not complete");
        require(block.timestamp <= updatedAt + MAX_STALENESS, "Price is stale");
    }

    function _getFallbackPrice() internal view returns (int256) {
        require(address(fallbackFeed) != address(0), "No fallback oracle available");

        try fallbackFeed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            uint256,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            _validatePriceData(roundId, price, updatedAt, answeredInRound);
            return price;
        } catch {
            revert("All oracles failed");
        }
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }

    function setFallbackOracle(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }
}
