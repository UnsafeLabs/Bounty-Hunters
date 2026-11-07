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
    uint256 public MAX_STALENESS = 3600; // 1 hour default

    event PriceQueried(int256 price, uint256 timestamp, bool isFallback);
    event FallbackFeedSet(address indexed fallbackFeed);
    event MaxStalenessUpdated(uint256 maxStaleness);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _primaryFeed) {
        require(_primaryFeed != address(0), "Invalid feed address");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function getLatestPrice() external view returns (int256) {
        // Try primary feed first
        (bool success, int256 price, uint256 updatedAt, bool isFresh) = _getPriceFromFeed(primaryFeed);
        
        if (success && isFresh) {
            emit PriceQueried(price, updatedAt, false);
            return price;
        }

        // Fallback to secondary feed if available
        if (address(fallbackFeed) != address(0)) {
            (success, price, updatedAt, isFresh) = _getPriceFromFeed(fallbackFeed);
            
            if (success && isFresh) {
                emit PriceQueried(price, updatedAt, true);
                return price;
            }
        }

        revert("No valid price available");
    }

    function _getPriceFromFeed(AggregatorV3Interface feed) internal view returns (
        bool success,
        int256 price,
        uint256 updatedAt,
        bool isFresh
    ) {
        try feed.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256, // startedAt
            uint256 updatedAt_,
            uint80 answeredInRound
        ) {
            // Validate price is positive
            if (answer <= 0) {
                return (false, 0, 0, false);
            }

            // Validate round completeness
            if (answeredInRound < roundId) {
                return (false, 0, 0, false);
            }

            // Validate staleness
            if (block.timestamp - updatedAt_ >= MAX_STALENESS) {
                return (false, 0, 0, false);
            }

            return (true, answer, updatedAt_, true);
        } catch {
            return (false, 0, 0, false);
        }
    }

    function setFallbackFeed(address _fallbackFeed) external onlyOwner {
        require(_fallbackFeed != address(0), "Invalid feed address");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        emit FallbackFeedSet(_fallbackFeed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Invalid staleness");
        require(_maxStaleness >= 60, "Too short"); // Minimum 1 minute
        MAX_STALENESS = _maxStaleness;
        emit MaxStalenessUpdated(_maxStaleness);
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }
}
