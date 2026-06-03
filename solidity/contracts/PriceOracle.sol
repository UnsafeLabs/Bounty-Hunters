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
    AggregatorV3Interface public secondaryFeed;
    address public owner;
    uint256 public MAX_STALENESS = 3600; // 1 hour default

    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(uint256 primaryUpdatedAt); // emitted when falling back to secondary

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    /// @notice Sets the secondary fallback oracle address
    function setSecondaryFeed(address _secondaryFeed) external onlyOwner {
        secondaryFeed = AggregatorV3Interface(_secondaryFeed);
    }

    /// @notice Updates the staleness threshold (in seconds)
    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        MAX_STALENESS = _maxStaleness;
    }

    /// @notice Returns the latest valid price.
    /// @dev Validates primary feed for completeness, positive price, and freshness.
    ///      Falls back to secondary if primary is stale. Reverts if both are stale.
    function getLatestPrice() external view returns (int256) {
        // Try primary feed
        (uint80 roundId, int256 price, , uint256 updatedAt, uint80 answeredInRound) = primaryFeed.latestRoundData();
        require(answeredInRound >= roundId, "Incomplete round");
        require(price > 0, "Invalid price");
        if (block.timestamp - updatedAt < MAX_STALENESS) {
            // Primary is fresh
            return price;
        }

        // Primary is stale – emit event and try secondary
        emit StalePrice(updatedAt);

        require(address(secondaryFeed) != address(0), "No secondary oracle");

        (uint80 roundId2, int256 price2, , uint256 updatedAt2, uint80 answeredInRound2) = secondaryFeed.latestRoundData();
        require(answeredInRound2 >= roundId2, "Secondary: Incomplete round");
        require(price2 > 0, "Secondary: Invalid price");
        require(block.timestamp - updatedAt2 < MAX_STALENESS, "Both oracles stale");

        return price2;
    }

    /// @notice Returns the number of decimals for the primary feed
    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }
}