solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/// @title PriceOracle
/// @notice Fetches validated prices from Chainlink oracles with primary/fallback, staleness,
///         completeness, and zero/negative checks.
/// @dev Owner can configure maxStaleness, primaryOracle, and fallbackOracle.
///      Invalid prices (<=0) or incomplete rounds revert immediately.
///      Stale primary data triggers a StalePrice event and fallback query.
///      If both oracles are stale, the function reverts.
///      All external oracle calls are wrapped in try/catch to handle reverts.
contract PriceOracle {
    // ===================== Errors =====================
    /// @dev Revert when the price returned is zero or negative.
    error InvalidPrice();

    /// @dev Revert when the Chainlink round is incomplete (answeredInRound < roundId).
    error IncompleteRound();

    /// @dev Revert when price data from both oracles is stale or unavailable.
    error BothOraclesStale();

    /// @dev Revert when an oracle address is zero where required.
    error InvalidAddress();

    /// @dev Revert when the external oracle call reverts.
    error OracleCallFailed();

    /// @dev Revert when the primary oracle is not set.
    error PrimaryNotSet();

    /// @dev Revert when the fallback oracle is not set.
    error FallbackNotSet();

    /// @dev Revert when maxStaleness is set to zero.
    error StalenessMustBePositive();

    /// @dev Revert when both oracles are not set.
    error NoOracleAvailable();

    // ===================== Events =====================
    /// @notice Emitted when the primary oracle returns stale data and the contract falls back.
    /// @param primaryOracle Address of the primary oracle.
    /// @param lastUpdateTimestamp Timestamp of the last update from the primary oracle.
    /// @param fallbackOracle Address of the fallback oracle now being queried.
    event StalePrice(
        address indexed primaryOracle,
        uint256 lastUpdateTimestamp,
        address indexed fallbackOracle
    );

    /// @notice Emitted when maxStaleness is updated.
    /// @param newMaxStaleness Updated maximum staleness in seconds.
    event MaxStalenessUpdated(uint256 newMaxStaleness);

    /// @notice Emitted when the fallback oracle address changes.
    /// @param newFallbackOracle New fallback oracle address.
    event FallbackOracleUpdated(address indexed newFallbackOracle);

    /// @notice Emitted when the primary oracle address changes.
    /// @param newPrimaryOracle New primary oracle address.
    event PrimaryOracleUpdated(address indexed newPrimaryOracle);

    // ===================== State Variables =====================
    /// @notice Primary Chainlink aggregator. Can be set to address(0) if unused.
    AggregatorV3Interface public primaryOracle;

    /// @notice Secondary fallback aggregator. Can be set to address(0) if unused.
    AggregatorV3Interface public fallbackOracle;

    /// @notice Maximum allowed age (in seconds) of oracle price data. Configurable by owner.
    uint256 public maxStaleness;

    /// @notice Contract owner with administrative privileges. Immutable for gas efficiency.
    address public immutable owner;

    // ===================== Modifiers =====================
    /// @dev Restricts function access to the contract owner.
    modifier onlyOwner() {
        if (msg.sender != owner) revert("Caller is not the owner");
        _;
    }

    // ===================== Constructor =====================
    /// @notice Initializes the price oracle with primary and fallback aggregators.
    /// @param _primaryOracle Address of the primary Chainlink aggregator (zero allowed if only fallback is used).
    /// @param _fallbackOracle Address of the fallback aggregator (zero allowed if not needed).
    /// @param _maxStaleness Initial staleness threshold in seconds (must be > 0).
    /// @dev At least one oracle must be non‑zero.
    constructor(
        address _primaryOracle,
        address _fallbackOracle,
        uint256 _maxStaleness
    ) {
        if (_primaryOracle == address(0) && _fallbackOracle == address(0))
            revert InvalidAddress();

        if (_primaryOracle != address(0)) {
            primaryOracle = AggregatorV3Interface(_primaryOracle);
        }
        if (_fallbackOracle != address(0)) {
            fallbackOracle = AggregatorV3Interface(_fallbackOracle);
        }
        if (_maxStaleness == 0) revert StalenessMustBePositive();
        maxStaleness = _maxStaleness;
        owner = msg.sender;

        // Emit initial configuration events
        if (_primaryOracle != address(0)) {
            emit PrimaryOracleUpdated(_primaryOracle);
        }
        if (_fallbackOracle != address(0)) {
            emit FallbackOracleUpdated(_fallbackOracle);
        }
        emit MaxStalenessUpdated(_maxStaleness);
    }

    // ===================== Owner Configurables =====================
    /// @notice Updates the staleness threshold.
    /// @param _newMaxStaleness New maximum age in seconds (must be > 0).
    function setMaxStaleness(uint256 _newMaxStaleness) external onlyOwner {
        if (_newMaxStaleness == 0) revert StalenessMustBePositive();
        maxStaleness = _newMaxStaleness;
        emit MaxStalenessUpdated(_newMaxStaleness);
    }

    /// @notice Updates the fallback oracle address.
    /// @param _fallbackOracle Address of the new fallback aggregator (zero allowed to disable fallback).
    function setFallbackOracle(address _fallbackOracle) external onlyOwner {
        // Allow setting to address(0) to disable fallback, but we enforce at least one non-zero in getPrice.
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
        emit FallbackOracleUpdated(_fallbackOracle);
    }

    /// @notice Updates the primary oracle address.
    /// @param _primaryOracle Address of the new primary aggregator (zero allowed to disable primary).
    function setPrimaryOracle(address _primaryOracle) external onlyOwner {
        primaryOracle = AggregatorV3Interface(_primaryOracle);
        emit PrimaryOracleUpdated(_primaryOracle);
    }

    // ===================== Public View Functions =====================
    /// @notice Returns the number of decimals for the primary oracle.
    /// @dev Reverts if primary oracle is not set. For fallback decimals use decimalsFallback().
    /// @return decimals The number of decimals.
    function decimals() external view returns (uint8) {
        if (address(primaryOracle) == address(0)) revert PrimaryNotSet();
        return primaryOracle.decimals();
    }

    /// @notice Returns the number of decimals for the fallback oracle.
    /// @dev Reverts if fallback oracle is not set.
    /// @return decimals The number of decimals.
    function decimalsFallback() external view returns (uint8) {
        if (address(fallbackOracle) == address(0)) revert FallbackNotSet();
        return fallbackOracle.decimals();
    }

    /// @notice Returns the current staleness threshold in seconds.
    /// @return staleness Maximum allowed age of price data.
    function staleness() external view returns (uint256) {
        return maxStaleness;
    }

    /// @notice Returns the owner address.
    /// @return ownerAddress The address of the contract owner.
    function getOwner() external view returns (address) {
        return owner;
    }

    /// @notice Returns the latest round data from the primary oracle without validation.
    /// @dev For transparency only. Not used by getPrice().
    /// @return roundId Round ID
    /// @return answer Price
    /// @return startedAt Timestamp when round started
    /// @return updatedAt Timestamp when round was updated
    /// @return answeredInRound Round ID where answer was computed
    function peekPrimary() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        if (address(primaryOracle) == address(0)) revert PrimaryNotSet();
        return primaryOracle.latestRoundData();
    }

    /// @notice Returns the latest round data from the fallback oracle without validation.
    /// @dev For transparency only. Not used by getPrice().
    /// @return roundId Round ID
    /// @return answer Price
    /// @return startedAt Timestamp when round started
    /// @return updatedAt Timestamp when round was updated
    /// @return answeredInRound Round ID where answer was computed
    function peekFallback() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        if (address(fallbackOracle) == address(0)) revert FallbackNotSet();
        return fallbackOracle.latestRoundData();
    }

    // ===================== Core Price Fetch =====================
    /// @notice Fetches a validated price from the primary oracle, falling back to the secondary if the primary data is stale.
    /// @dev Reverts on InvalidPrice (zero/negative), IncompleteRound, or BothOraclesStale.
    ///      Emits StalePrice only when primary oracle returns stale data and fallback is attempted.
    /// @return price The validated, positive, and fresh price (int256).
    function getPrice() external returns (int256 price) {
        bool primarySet = address(primaryOracle) != address(0);
        bool fallbackSet = address(fallbackOracle) != address(0);

        if (!primarySet && !fallbackSet) revert NoOracleAvailable();

        // 1. Attempt primary oracle if set
        if (primarySet) {
            (bool valid, int256 p, uint256 updatedAt) = _tryGetValidPrice(primaryOracle);
            if (valid) {
                return p;
            }
            // Primary returned stale – emit event
            emit StalePrice(
                address(primaryOracle),
                updatedAt,
                address(fallbackOracle)
            );
        }

        // 2. Fallback to secondary if primary is not set or stale
        if (fallbackSet) {
            (bool valid, int256 p, ) = _tryGetValidPrice(fallbackOracle);
            if (valid) {
                return p;
            }
        }

        // 3. Both oracles returned stale or not set, revert
        revert BothOraclesStale();
    }

    /// @notice Internal helper to fetch and validate price from a single oracle.
    /// @param oracle The Chainlink aggregator interface.
    /// @return success Whether the price is valid (positive, complete, not stale).
    /// @return price The price if valid, otherwise 0.
    /// @return updatedAt The last update timestamp, used for event emission.
    function _tryGetValidPrice(AggregatorV3Interface oracle) internal returns (bool success, int256 price, uint256 updatedAt) {
        // Wrap in try/catch to handle any revert from the external call (e.g., network error)
        try oracle.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256 /* startedAt */,
            uint256 _updatedAt,
            uint80 answeredInRound
        ) {
            // 1. Round completeness check
            if (answeredInRound < roundId) revert IncompleteRound();

            // 2. Price validity (positive)
            if (answer <= 0) revert InvalidPrice();

            // 3. Staleness check
            if (block.timestamp - _updatedAt > maxStaleness) {
                // Stale: return the data but with success=false for the caller to use fallback
                // Do not revert here; caller will handle.
                return (false, answer, _updatedAt);
            }

            // All checks passed
            return (true, answer, _updatedAt);
        } catch (bytes memory /* reason */) {
            // External call failed (e.g., contract not found, out-of-gas)
            revert OracleCallFailed();
        }
    }
}