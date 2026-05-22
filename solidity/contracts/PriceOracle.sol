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
    event StalePrice(uint256 primaryTimestamp, uint256 fallbackTimestamp);
    event FallbackFeedUpdated(address oldFeed, address newFeed);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    /**
     * @notice Get the latest price with staleness and validity checks
     * @return price The latest valid price from Chainlink oracles
     * @dev Reverts if both oracles return stale or invalid data
     */
    function getLatestPrice() external view returns (int256) {
        (
            uint80 primaryRoundId,
            int256 primaryPrice,
            ,
            uint256 primaryUpdatedAt,
            uint80 primaryAnsweredInRound
        ) = primaryFeed.latestRoundData();

        // Check round completeness for primary feed
        if (primaryAnsweredInRound < primaryRoundId) {
            // Try fallback oracle
            return _getPriceFromFallback();
        }

        // Check for negative or zero price
        if (primaryPrice <= 0) {
            // Try fallback oracle
            return _getPriceFromFallback();
        }

        // Check staleness
        if (block.timestamp - primaryUpdatedAt >= MAX_STALENESS) {
            emit StalePrice(primaryUpdatedAt, _getFallbackTimestamp());
            // Try fallback oracle
            return _getPriceFromFallback();
        }

        emit PriceQueried(primaryPrice, primaryUpdatedAt);
        return primaryPrice;
    }

    /**
     * @notice Get price from fallback oracle
     * @return price The price from fallback feed
     * @dev Reverts if fallback is also stale or invalid
     */
    function _getPriceFromFallback() internal view returns (int256) {
        (
            uint80 fallbackRoundId,
            int256 fallbackPrice,
            ,
            uint256 fallbackUpdatedAt,
            uint80 fallbackAnsweredInRound
        ) = fallbackFeed.latestRoundData();

        // Validate fallback
        if (fallbackAnsweredInRound < fallbackRoundId) {
            revert("Both oracles have incomplete rounds");
        }
        if (fallbackPrice <= 0) {
            revert("Both oracles have invalid prices");
        }
        if (block.timestamp - fallbackUpdatedAt >= MAX_STALENESS) {
            revert("Both oracles are stale");
        }

        emit PriceQueried(fallbackPrice, fallbackUpdatedAt);
        return fallbackPrice;
    }

    /**
     * @notice Get the fallback feed's last update timestamp
     * @return timestamp The updatedAt value from fallback feed
     */
    function _getFallbackTimestamp() internal view returns (uint256) {
        (, , , uint256 updatedAt, ) = fallbackFeed.latestRoundData();
        return updatedAt;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }

    /**
     * @notice Update the fallback oracle feed
     * @param _newFallbackFeed The new fallback feed address
     */
    function setFallbackFeed(address _newFallbackFeed) external {
        require(msg.sender == owner, "Not owner");
        address oldFeed = address(fallbackFeed);
        fallbackFeed = AggregatorV3Interface(_newFallbackFeed);
        emit FallbackFeedUpdated(oldFeed, _newFallbackFeed);
    }
}
