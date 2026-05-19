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
    uint256 public MAX_STALENESS = 3600; // 1 hour

    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(address indexed oracle, uint256 lastUpdated, uint256 staleness);
    event FallbackUsed(address indexed primary, address indexed fallback);
    event MaxStalenessUpdated(uint256 oldValue, uint256 newValue);

    constructor(address _primaryFeed, address _fallbackFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed");
        require(_fallbackFeed != address(0), "Invalid fallback feed");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    /// @notice Get the latest price, falling back to secondary oracle if primary is stale.
    /// @return price The validated price from the best available oracle.
    function getLatestPrice() external view returns (int256) {
        // Try primary feed first
        (int256 price, bool isStale) = _getValidatedPrice(primaryFeed);

        if (!isStale && price > 0) {
            emit PriceQueried(price, block.timestamp);
            return price;
        }

        // Primary is stale or invalid — try fallback
        if (isStale) {
            emit FallbackUsed(address(primaryFeed), address(fallbackFeed));
        }

        (int256 fallbackPrice, bool fallbackStale) = _getValidatedPrice(fallbackFeed);

        require(!fallbackStale, "Both oracles return stale data");
        require(fallbackPrice > 0, "Invalid price from fallback oracle");

        emit PriceQueried(fallbackPrice, block.timestamp);
        return fallbackPrice;
    }

    /// @notice Validate a Chainlink oracle response for staleness, completeness, and price validity.
    /// @param feed The oracle to query.
    /// @return price The validated price, or 0 if invalid.
    /// @return isStale True if the oracle returned stale data.
    function _getValidatedPrice(AggregatorV3Interface feed)
        internal
        view
        returns (int256 price, bool isStale)
    {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        // Check round completeness
        require(answeredInRound >= roundId, "Incomplete round");

        // Check for negative or zero price
        require(answer > 0, "Invalid price");

        // Check staleness
        uint256 staleness = block.timestamp - updatedAt;
        if (staleness >= MAX_STALENESS) {
            emit StalePrice(address(feed), updatedAt, staleness);
            return (0, true);
        }

        return (answer, false);
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        require(_maxStaleness > 0, "Max staleness must be > 0");
        uint256 oldValue = MAX_STALENESS;
        MAX_STALENESS = _maxStaleness;
        emit MaxStalenessUpdated(oldValue, _maxStaleness);
    }

    /// @notice Update oracle addresses (owner only).
    function setPrimaryFeed(address _feed) external {
        require(msg.sender == owner, "Not owner");
        require(_feed != address(0), "Invalid address");
        primaryFeed = AggregatorV3Interface(_feed);
    }

    function setFallbackFeed(address _feed) external {
        require(msg.sender == owner, "Not owner");
        require(_feed != address(0), "Invalid address");
        fallbackFeed = AggregatorV3Interface(_feed);
    }
}
