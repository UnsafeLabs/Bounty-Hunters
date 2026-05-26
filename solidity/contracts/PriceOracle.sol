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
    event FallbackUsed(int256 price, uint256 timestamp);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256) {
        // Try primary feed with full validation
        try primaryFeed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            if (_isValidPrice(roundId, price, startedAt, updatedAt, answeredInRound)) {
                return price;
            }
        } catch {}

        // Try fallback feed if available
        if (address(fallbackFeed) != address(0)) {
            try fallbackFeed.latestRoundData() returns (
                uint80 roundId,
                int256 price,
                uint256 startedAt,
                uint256 updatedAt,
                uint80 answeredInRound
            ) {
                require(_isValidPrice(roundId, price, startedAt, updatedAt, answeredInRound), "Both feeds stale/invalid");
                return price;
            } catch {}
        }

        revert("No valid price feed available");
    }

    function _isValidPrice(
        uint80 roundId,
        int256 price,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) internal view returns (bool) {
        if (price <= 0) return false;
        if (answeredInRound < roundId) return false;
        if (block.timestamp - updatedAt > MAX_STALENESS) return false;
        if (updatedAt == 0 || startedAt == 0) return false;
        return true;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        require(_maxStaleness > 0, "Staleness must be > 0");
        MAX_STALENESS = _maxStaleness;
    }

    function setFallbackFeed(address _fallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }
}
