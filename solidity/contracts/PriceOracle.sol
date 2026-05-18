// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Chainlink Aggregator interface for fetching round data
interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );

    function decimals() external view returns (uint8);
}

/// @title PriceOracle - Fetches asset prices from Chainlink with fallback and staleness validation
/// @notice Provides a secure price oracle with secondary fallback, stale data rejection, and owner-adjustable staleness threshold
/// @dev Reverts on incomplete rounds, zero/negative prices, and stale data without a valid fallback
contract PriceOracle {
    // ═══════════════════════════════════════════════════════════════════════════
    // Custom Errors
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev Incomplete round data from an oracle
    error IncompleteRound();

    /// @dev Price returned was zero or negative
    error InvalidPrice();

    /// @dev Primary oracle price is stale and no fallback is configured
    error StalePriceNoFallback();

    /// @dev Fallback oracle also returned stale data
    error BothOraclesStale();

    /// @dev Caller is not the contract owner
    error OnlyOwner();

    /// @dev Address zero is invalid for oracle feed
    error ZeroAddress();

    /// @dev Staleness threshold must be greater than zero
    error InvalidStaleness();

    /// @dev Fallback feed must be different from primary feed (or zero to disable)
    error SameFeedAddress();

    // ═══════════════════════════════════════════════════════════════════════════
    // State Variables
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Primary Chainlink feed (source of truth)
    AggregatorV3Interface public primaryFeed;

    /// @notice Fallback feed used when primary is stale
    AggregatorV3Interface public fallbackFeed;

    /// @notice Contract owner (can update feeds and staleness)
    address public immutable owner;

    /// @notice Maximum acceptable age of a price in seconds (default 1 hour)
    uint256 public maxStaleness = 3600;

    // ═══════════════════════════════════════════════════════════════════════════
    // Events
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev Emitted when a price is successfully fetched from either oracle
    /// @param price The fetched price (always positive)
    /// @param timestamp Timestamp of the fetched price update
    event PriceQueried(int256 indexed price, uint256 indexed timestamp);

    /// @dev Emitted when primary oracle is stale and fallback is used
    /// @param primaryUpdatedAt Last update time of the primary oracle
    event StalePrice(uint256 primaryUpdatedAt);

    /// @dev Emitted when maxStaleness is changed
    /// @param newStaleness New threshold in seconds
    event MaxStalenessUpdated(uint256 newStaleness);

    /// @dev Emitted when primary feed address is updated
    /// @param newFeed New primary feed address
    event PrimaryFeedUpdated(address indexed newFeed);

    /// @dev Emitted when fallback feed address is updated
    /// @param newFallback New fallback feed address
    event FallbackFeedUpdated(address indexed newFallback);

    /// @dev Emitted when fallback feed is disabled (set to address(0))
    event FallbackFeedDisabled();

    // ═══════════════════════════════════════════════════════════════════════════
    // Constructor
    // ═══════════════════════════════════════════════════════════════════════════

    /// @param _primaryFeed Address of the primary Chainlink aggregator
    /// @dev Sets the contract deployer as the owner and initializes the primary feed
    constructor(address _primaryFeed) {
        if (_primaryFeed == address(0)) revert ZeroAddress();
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Modifiers
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev Restricts function access to the contract owner
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Internal Helpers
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Queries an aggregator and validates the round data
    /// @dev Returns validated price and update timestamp, reverts on invalid data
    /// @param feed The Chainlink aggregator interface
    /// @return price The validated positive price
    /// @return updatedAt The timestamp of the last update
    function _readFeed(AggregatorV3Interface feed)
        internal
        view
        returns (int256 price, uint256 updatedAt)
    {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 liveUpdatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        // Validate round completeness
        if (answeredInRound < roundId) revert IncompleteRound();

        // Validate price positivity
        if (answer <= 0) revert InvalidPrice();

        return (answer, liveUpdatedAt);
    }

    /// @notice Checks if a price update is stale according to the current staleness threshold
    /// @dev Uses strict greater-than to treat exactly maxStaleness-old data as fresh
    /// @param updatedAt The timestamp of the price update
    /// @return isStale True if the update is older than maxStaleness
    function _isStale(uint256 updatedAt) internal view returns (bool) {
        return block.timestamp - updatedAt > maxStaleness;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Core Functions
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Fetches the latest price from the primary oracle, with fallback on stale data
    /// @dev Emits PriceQueried with the final price. Falls back to secondary feed if primary
    ///      data is stale (older than maxStaleness). Reverts if both oracles are stale.
    /// @return price The current price as a signed integer (always positive)
    function getLatestPrice() external returns (int256 price) {
        // ── Primary oracle query ─────────────────────────────────────────────
        (int256 answer, uint256 updatedAt) = _readFeed(primaryFeed);

        // ── Staleness check ──────────────────────────────────────────────────
        if (_isStale(updatedAt)) {
            uint256 primaryUpdatedAt = updatedAt;

            // Fallback must be configured
            if (address(fallbackFeed) == address(0)) revert StalePriceNoFallback();

            // Fallback must be different from primary to avoid redundancy
            if (address(fallbackFeed) == address(primaryFeed)) revert SameFeedAddress();

            // Query fallback feed
            (answer, updatedAt) = _readFeed(fallbackFeed);

            // Validate fallback freshness
            if (_isStale(updatedAt)) revert BothOraclesStale();

            emit StalePrice(primaryUpdatedAt);
            price = answer;
        } else {
            price = answer;
        }

        emit PriceQueried(price, updatedAt);
    }

    /// @notice Returns the latest price without emitting events - suitable for off-chain view calls
    /// @dev Reverts on incomplete rounds, invalid prices, or stale data
    /// @return price The current price (always positive)
    function peekPrice() external view returns (int256 price) {
        // ── Primary oracle query ─────────────────────────────────────────────
        (int256 answer, uint256 updatedAt) = _readFeed(primaryFeed);

        // ── Staleness check ──────────────────────────────────────────────────
        if (_isStale(updatedAt)) {
            // Fallback must be configured
            if (address(fallbackFeed) == address(0)) revert StalePriceNoFallback();

            // Query fallback feed
            (answer, updatedAt) = _readFeed(fallbackFeed);

            // Validate fallback freshness
            if (_isStale(updatedAt)) revert BothOraclesStale();

            price = answer;
        } else {
            price = answer;
        }
    }

    /// @notice Returns the number of decimals used by the primary feed
    /// @return decimals Number of decimals (e.g. 8 for USD pairs)
    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Admin Functions
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Updates the maximum staleness period for price data
    /// @param _maxStaleness New staleness threshold in seconds (must be > 0)
    /// @dev Only callable by the contract owner. Emits MaxStalenessUpdated.
    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        if (_maxStaleness == 0) revert InvalidStaleness();
        maxStaleness = _maxStaleness;
        emit MaxStalenessUpdated(_maxStaleness);
    }

    /// @notice Sets the primary oracle feed address
    /// @param _newFeed Address of the new primary Chainlink aggregator
    /// @dev Only callable by owner. Must not be zero. Emits PrimaryFeedUpdated.
    function setPrimaryFeed(address _newFeed) external onlyOwner {
        if (_newFeed == address(0)) revert ZeroAddress();
        primaryFeed = AggregatorV3Interface(_newFeed);
        emit PrimaryFeedUpdated(_newFeed);
    }

    /// @notice Sets the fallback oracle feed address
    /// @param _fallbackFeed Address of the fallback Chainlink aggregator (or zero to disable fallback)
    /// @dev Only callable by owner. Must not be the same as primary feed. Emits FallbackFeedUpdated or FallbackFeedDisabled.
    function setFallbackFeed(address _fallbackFeed) external onlyOwner {
        if (_fallbackFeed == address(0)) {
            delete fallbackFeed;
            emit FallbackFeedDisabled();
            return;
        }
        // Ensure fallback is not the same as primary to prevent redundancy
        if (_fallbackFeed == address(primaryFeed)) revert SameFeedAddress();
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        emit FallbackFeedUpdated(_fallbackFeed);
    }
}
/*
.generation_meta.json
{
  "agent": "AIGON Enterprise AI",
  "initial_directives": "Improve PriceOracle contract to maximum production quality: add staleness validation (strictly older than 1 hour), round completeness check, negative/zero price rejection, fallback oracle with StalePrice event, separate view function for off-chain queries, validation that fallback differs from primary, and configurable maxStaleness by owner.",
  "date": "2025-04-05T12:00:00Z"
}
*/