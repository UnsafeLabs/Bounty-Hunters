solidity
// contracts/PriceOracle.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IAggregatorV3Interface
 * @notice Minimal interface for Chainlink aggregator.
 */
interface IAggregatorV3Interface {
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
}

/**
 * @title PriceOracle
 * @notice Fetches asset prices from Chainlink oracles with staleness protection, fallback, and robust error handling.
 * @dev Uses two oracles: primary (immutable) and fallback (upgradable). If primary returns stale or reverts,
 *      attempts fallback. Reverts if both are stale/invalid. MAX_STALENESS is configurable by owner.
 *      Emits events for stale price detection and configuration changes.
 */
contract PriceOracle is Ownable {
    // ──────────────────────────────────────────────
    //  Custom Errors
    // ──────────────────────────────────────────────
    /// @notice Reverted when the fetched price is zero or negative.
    error InvalidPrice(int256 price);

    /// @notice Reverted when the Chainlink round data is incomplete.
    error RoundIncomplete();

    /// @notice Reverted when both primary and fallback oracles return stale or invalid data.
    error BothOraclesStaleOrFailed();

    /// @notice Reverted when an address parameter is the zero address.
    error ZeroAddress();

    /// @notice Reverted when max staleness is set to zero.
    error ZeroStaleness();

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────
    /// @notice Emitted when primary oracle price is stale and fallback is attempted.
    /// @param primaryUpdatedAt The last update timestamp from the primary oracle (0 if call reverted).
    event StalePrice(uint256 indexed primaryUpdatedAt);

    /// @notice Emitted when MAX_STALENESS is changed.
    /// @param newStaleness The new staleness threshold in seconds.
    event StalenessUpdated(uint256 indexed newStaleness);

    /// @notice Emitted when fallback oracle address is changed.
    /// @param newFallback The new fallback oracle address.
    event FallbackOracleUpdated(address indexed newFallback);

    /// @notice Emitted when a fresh price is successfully fetched and stored.
    /// @param price The validated price.
    /// @param timestamp The update timestamp of the successful oracle.
    event PriceUpdated(int256 indexed price, uint256 indexed timestamp);

    // ──────────────────────────────────────────────
    //  State Variables
    // ──────────────────────────────────────────────
    /// @notice Primary Chainlink aggregator (immutable).
    IAggregatorV3Interface public immutable primaryOracle;

    /// @notice Fallback Chainlink aggregator (upgradable by owner).
    IAggregatorV3Interface public fallbackOracle;

    /// @notice Maximum allowed age (in seconds) for a price before it is considered stale.
    uint256 public maxStaleness;

    /// @notice Last successfully fetched price (cached for gas-efficient view reads).
    int256 public lastPrice;

    /// @notice Timestamp of the last successfully fetched price.
    uint256 public lastTimestamp;

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────
    /// @notice Ensures an oracle address is not zero.
    /// @param oracleAddr The address to validate.
    modifier validOracle(address oracleAddr) {
        if (oracleAddr == address(0)) revert ZeroAddress();
        _;
    }

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────
    /**
     * @notice Constructs the PriceOracle with a primary oracle and initial staleness.
     * @param _primaryOracle Address of the primary Chainlink aggregator (cannot be changed).
     * @param _maxStaleness Maximum allowed age of price data in seconds (must be > 0).
     */
    constructor(
        address _primaryOracle,
        uint256 _maxStaleness
    )
        Ownable()
        validOracle(_primaryOracle)
    {
        if (_maxStaleness == 0) revert ZeroStaleness();
        primaryOracle = IAggregatorV3Interface(_primaryOracle);
        maxStaleness = _maxStaleness;
    }

    // ──────────────────────────────────────────────
    //  Owner Configuration
    // ──────────────────────────────────────────────

    /**
     * @notice Updates the staleness threshold.
     * @param _newStaleness New value in seconds (must be > 0).
     * @custom:reverts ZeroStaleness if the input is zero.
     */
    function setMaxStaleness(uint256 _newStaleness) external onlyOwner {
        if (_newStaleness == 0) revert ZeroStaleness();
        maxStaleness = _newStaleness;
        emit StalenessUpdated(_newStaleness);
    }

    /**
     * @notice Sets the fallback oracle address. Use address(0) to disable fallback.
     * @dev Only callable by the contract owner.
     * @param _newFallback Address of the fallback Chainlink aggregator.
     * @custom:reverts ZeroAddress if the new address is zero.
     */
    function setFallbackOracle(address _newFallback)
        external
        onlyOwner
        validOracle(_newFallback)
    {
        fallbackOracle = IAggregatorV3Interface(_newFallback);
        emit FallbackOracleUpdated(_newFallback);
    }

    // ──────────────────────────────────────────────
    //  Core Price Fetch (State-changing)
    // ──────────────────────────────────────────────

    /**
     * @notice Fetches the latest price from the primary oracle.
     *         If stale or the call reverts, falls back to the secondary oracle.
     *         Updates `lastPrice` and `lastTimestamp` and emits `PriceUpdated`.
     * @return price The validated price (positive integer).
     * @return timestamp The update timestamp of the successful oracle.
     * @custom:reverts InvalidPrice if price <= 0.
     * @custom:reverts RoundIncomplete if answeredInRound < roundId.
     * @custom:reverts BothOraclesStaleOrFailed if primary is stale/fails and fallback is also stale/fails
     *          or if fallback is not set.
     */
    function getPrice()
        external
        returns (int256 price, uint256 timestamp)
    {
        // Attempt primary oracle with try/catch for robustness.
        (bool primarySuccess, int256 primaryPrice, uint256 primaryTimestamp) =
            _safeOracleCall(primaryOracle);

        if (primarySuccess && _isFresh(primaryTimestamp)) {
            // Primary valid and fresh – use it.
            price = primaryPrice;
            timestamp = primaryTimestamp;
        } else {
            // Primary stale or failed – attempt fallback.
            if (!primarySuccess) {
                // If the call reverted, we have no timestamp; use 0 for event.
                emit StalePrice(0);
            } else {
                emit StalePrice(primaryTimestamp);
            }

            // If no fallback is set, revert.
            if (address(fallbackOracle) == address(0)) {
                revert BothOraclesStaleOrFailed();
            }

            (bool fallbackSuccess, int256 fallbackPrice, uint256 fallbackTimestamp) =
                _safeOracleCall(fallbackOracle);

            if (!fallbackSuccess || !_isFresh(fallbackTimestamp)) {
                revert BothOraclesStaleOrFailed();
            }

            price = fallbackPrice;
            timestamp = fallbackTimestamp;
        }

        // Cache the fresh price.
        lastPrice = price;
        lastTimestamp = timestamp;
        emit PriceUpdated(price, timestamp);
    }

    // ──────────────────────────────────────────────
    //  View Functions (Gas-efficient)
    // ──────────────────────────────────────────────

    /**
     * @notice Returns the last fetched price and timestamp without any new external calls.
     * @dev Does **not** check staleness; use for gas‑sensitive reads where staleness tolerance is acceptable.
     * @return price The last successfully fetched price.
     * @return timestamp The timestamp of that price.
     */
    function getLastPrice() external view returns (int256 price, uint256 timestamp) {
        return (lastPrice, lastTimestamp);
    }

    // ──────────────────────────────────────────────
    //  Internal Helpers
    // ──────────────────────────────────────────────

    /**
     * @notice Safely calls `latestRoundData` on an oracle, returning false on any failure.
     * @dev Does not revert; handles both external call failures and validation failures (invalid price, incomplete round).
     * @param oracle The Chainlink aggregator interface.
     * @return success True if the call succeeded and the returned data passed validation.
     * @return price The validated price (positive) if successful, otherwise 0.
     * @return updatedAt The round timestamp if successful, otherwise 0.
     */
    function _safeOracleCall(IAggregatorV3Interface oracle)
        private
        view
        returns (bool success, int256 price, uint256 updatedAt)
    {
        // Use try/catch to handle reverts from the external call (e.g., out of gas, paused contract).
        try oracle.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            , // startedAt – ignored
            uint256 updatedAt_,
            uint80 answeredInRound
        ) {
            // Validation 1: Round completeness.
            if (answeredInRound < roundId) {
                // Round incomplete – treat as failure.
                return (false, 0, 0);
            }

            // Validation 2: Positive price.
            if (answer <= 0) {
                // Invalid price (zero or negative) – treat as failure.
                return (false, 0, 0);
            }

            // All validations passed.
            return (true, answer, updatedAt_);
        } catch {
            // External call reverted – treat as failure.
            return (false, 0, 0);
        }
    }

    /**
     * @notice Checks whether a given timestamp is still fresh according to the current `maxStaleness`.
     * @param _updatedAt The timestamp of the price data.
     * @return True if the price is not older than `maxStaleness` seconds.
     */
    function _isFresh(uint256 _updatedAt) private view returns (bool) {
        // Underflow check: ensure block.timestamp >= _updatedAt (should always hold).
        return (block.timestamp >= _updatedAt) &&
               (block.timestamp - _updatedAt < maxStaleness);
    }
}