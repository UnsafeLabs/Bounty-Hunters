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

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    /**
     * @notice Get the latest price with staleness check and fallback
     * @return price The latest valid price
     * @dev Reverts if price is invalid (zero/negative) or round is incomplete
     * @dev Falls back to secondary oracle only if primary is stale
     */
    function getLatestPrice() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        // Validate round completeness - MUST revert, not fallback
        if (answeredInRound < roundId) {
            revert("Incomplete round data");
        }

        // Validate price - MUST revert, not fallback
        if (price <= 0) {
            revert("Invalid price");
        }

        // Check staleness - ONLY stale prices trigger fallback
        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            emit StalePrice(updatedAt, _getFallbackTimestamp());
            return _getPriceFromFallback();
        }

        emit PriceQueried(price, updatedAt);
        return price;
    }

    /**
     * @notice Get price from fallback oracle (called only when primary is stale)
     * @return price The price from fallback feed
     * @dev Reverts if fallback is also stale
     */
    function _getPriceFromFallback() internal view returns (int256) {
        (
            uint80 fallbackRoundId,
            int256 fallbackPrice,
            ,
            uint256 fallbackUpdatedAt,
            uint80 fallbackAnsweredInRound
        ) = fallbackFeed.latestRoundData();

        // Validate fallback round completeness
        if (fallbackAnsweredInRound < fallbackRoundId) {
            revert("Fallback oracle has incomplete round");
        }

        // Validate fallback price
        if (fallbackPrice <= 0) {
            revert("Fallback oracle has invalid price");
        }

        // Check fallback staleness
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
        fallbackFeed = AggregatorV3Interface(_newFallbackFeed);
    }
}
