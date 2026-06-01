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
    event StalePrice(uint256 lastUpdate, uint256 staleness);
    event FallbackUsed(int256 price, uint256 timestamp);

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

    function getLatestPrice() external view returns (int256) {
        try primaryFeed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            if (_isValidPrice(price, updatedAt, roundId, answeredInRound)) {
                return price;
            }
            emit StalePrice(updatedAt, block.timestamp - updatedAt);
        } catch {
            // Primary feed call failed
        }

        // Fallback to secondary oracle
        try fallbackFeed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            require(_isValidPrice(price, updatedAt, roundId, answeredInRound), "Both oracles stale");
            emit FallbackUsed(price, updatedAt);
            return price;
        } catch {
            revert("Both oracles failed");
        }
    }

    function _isValidPrice(
        int256 price,
        uint256 updatedAt,
        uint80 roundId,
        uint80 answeredInRound
    ) internal view returns (bool) {
        if (price <= 0) return false;
        if (answeredInRound < roundId) return false;
        if (block.timestamp - updatedAt >= MAX_STALENESS) return false;
        return true;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        MAX_STALENESS = _maxStaleness;
    }

    function setFallbackFeed(address _fallbackFeed) external onlyOwner {
        require(_fallbackFeed != address(0), "Invalid fallback feed");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }
}
