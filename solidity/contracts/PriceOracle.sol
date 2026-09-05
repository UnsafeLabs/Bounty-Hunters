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
    uint256 public MAX_STALENESS = 3600; // 1 hour

    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(uint256 primaryUpdatedAt, uint256 secondaryUpdatedAt);
    event FallbackActivated(address indexed newFeed);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    /// @notice Sets the fallback oracle feed
    /// @param _secondaryFeed Address of the secondary AggregatorV3Interface
    function setSecondaryFeed(address _secondaryFeed) external onlyOwner {
        secondaryFeed = AggregatorV3Interface(_secondaryFeed);
        emit FallbackActivated(_secondaryFeed);
    }

    /// @notice Updates the max staleness threshold
    /// @param _maxStaleness New staleness threshold in seconds
    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        MAX_STALENESS = _maxStaleness;
    }

    /// @notice Returns the latest price from the primary oracle, with staleness
    ///         check and automatic fallback to the secondary oracle.
    /// @return int256 The latest valid price
    function getLatestPrice() external view returns (int256) {
        return _getLatestPriceFromFeed(primaryFeed, true);
    }

    /// @notice Internal helper to fetch and validate price from a feed
    /// @param feed The AggregatorV3Interface to query
    /// @param isPrimary Whether this is the primary feed (emits StalePrice if secondary exists)
    /// @return int256 The validated price
    function _getLatestPriceFromFeed(AggregatorV3Interface feed, bool isPrimary) internal view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        // Reject zero or negative prices
        require(price > 0, "Invalid price");

        // Reject incomplete rounds (answeredInRound must be >= roundId)
        require(answeredInRound >= roundId, "Incomplete round");

        // Check staleness
        if (block.timestamp - updatedAt > MAX_STALENESS) {
            // Primary is stale — try fallback oracle
            if (address(secondaryFeed) != address(0)) {
                emit StalePrice(updatedAt, 0);
                return _getLatestPriceFromFeed(secondaryFeed, false);
            }
            revert("Stale price");
        }

        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }
}
