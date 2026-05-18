solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PriceOracle
 * @notice Fetches and validates prices from a primary Chainlink oracle with automatic
 *         fallback to a secondary oracle. Emits events for all fallback scenarios.
 * @dev The oracle maintains a cached price that can be updated via `updatePrice()`.
 *      `getPrice()` returns the latest valid price and reverts if no valid price exists.
 */
contract PriceOracle is Ownable, ReentrancyGuard {
    // ============ Types ============

    /// @notice Reason why fallback to secondary oracle was triggered.
    enum FallbackReason {
        NotApplicable,
        InvalidPrice,
        StalePrice,
        IncompleteRound,
        ExternalCallFailed
    }

    // ============ State Variables ============

    /// @notice Primary Chainlink aggregator (highest priority).
    AggregatorV3Interface public primaryOracle;

    /// @notice Secondary (fallback) Chainlink aggregator.
    AggregatorV3Interface public secondaryOracle;

    /// @notice Maximum age (in seconds) of a price feed to be considered fresh.
    uint256 public maxStaleness;

    /// @notice Latest successfully validated price in oracle decimals (usually 8 decimals).
    uint256 public lastPrice;

    /// @notice Timestamp when `lastPrice` was last updated.
    uint256 public lastUpdateTimestamp;

    /// @notice Round ID from which `lastPrice` was retrieved.
    uint80 public lastRoundId;

    /// @notice Flag indicating if a price has ever been set.
    bool public priceInitialized;

    /// @notice Default staleness threshold (1 hour).
    uint256 public constant DEFAULT_MAX_STALENESS = 3600;

    // ============ Events ============

    /// @notice Emitted when a valid price is retrieved from an oracle.
    event PriceUpdated(uint256 price, uint80 roundId, uint256 updatedAt, address indexed oracle);

    /// @notice Emitted when the primary oracle returns stale data and fallback is used.
    event StalePrice(uint256 primaryUpdatedAt, address indexed primaryOracle);

    /// @notice Emitted when both oracles fail and the transaction reverts.
    event BothOraclesFailed();

    /// @notice Emitted when a fallback is triggered for any reason other than staleness.
    event FallbackTriggered(FallbackReason reason, address indexed oracle);

    /// @notice Emitted when maxStaleness is updated by owner.
    event MaxStalenessUpdated(uint256 newStaleness, uint256 oldStaleness);

    /// @notice Emitted when an oracle address is updated.
    event OracleUpdated(address indexed oldOracle, address indexed newOracle, bool isPrimary);

    // ============ Errors ============

    error InvalidAddress();
    error InvalidStaleness(uint256 provided);
    error SameOracleAddress();
    error NotInitialized();
    error BothOraclesFailedError();
    error StaleDataFromBothOracles();
    error NegativePrice();
    error IncompleteRound();
    error ZeroAddress();

    // ============ Constructor ============

    /**
     * @notice Initializes the contract with two oracle addresses and a staleness threshold.
     * @param _primaryOracle Address of the primary Chainlink aggregator (must be non-zero).
     * @param _secondaryOracle Address of the fallback Chainlink aggregator (must be non-zero and != primary).
     * @param _maxStaleness Maximum allowed age in seconds for a price to be considered fresh.
     *                      If set to 0, DEFAULT_MAX_STALENESS (3600) is used.
     */
    constructor(
        address _primaryOracle,
        address _secondaryOracle,
        uint256 _maxStaleness
    ) Ownable(msg.sender) {
        if (_primaryOracle == address(0) || _secondaryOracle == address(0)) {
            revert InvalidAddress();
        }
        if (_primaryOracle == _secondaryOracle) {
            revert SameOracleAddress();
        }
        primaryOracle = AggregatorV3Interface(_primaryOracle);
        secondaryOracle = AggregatorV3Interface(_secondaryOracle);
        _setMaxStalenessInternal(_maxStaleness == 0 ? DEFAULT_MAX_STALENESS : _maxStaleness);
    }

    // ============ Owner Configuration ============

    /**
     * @notice Updates the max staleness threshold.
     * @param _maxStaleness New threshold in seconds. Must be > 0.
     */
    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        if (_maxStaleness == 0) revert InvalidStaleness(_maxStaleness);
        _setMaxStalenessInternal(_maxStaleness);
    }

    /**
     * @notice Updates the primary oracle address.
     * @param _oracle New primary oracle address. Must be non-zero and different from secondary.
     */
    function setPrimaryOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert InvalidAddress();
        if (_oracle == address(secondaryOracle)) revert SameOracleAddress();
        address old = address(primaryOracle);
        primaryOracle = AggregatorV3Interface(_oracle);
        emit OracleUpdated(old, _oracle, true);
    }

    /**
     * @notice Updates the secondary oracle address.
     * @param _oracle New secondary oracle address. Must be non-zero and different from primary.
     */
    function setSecondaryOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert InvalidAddress();
        if (_oracle == address(primaryOracle)) revert SameOracleAddress();
        address old = address(secondaryOracle);
        secondaryOracle = AggregatorV3Interface(_oracle);
        emit OracleUpdated(old, _oracle, false);
    }

    // ============ Public Functions ============

    /**
     * @notice Fetches the latest valid price from the primary oracle with fallback.
     * @dev Reverts if both oracles fail after exhausting fallback logic.
     *      Emits appropriate events for logging.
     */
    function updatePrice() external nonReentrant {
        // Attempt primary oracle.
        (
            bool success,
            uint256 price,
            uint80 roundId,
            uint256 updatedAt,
            FallbackReason reason
        ) = _fetchValidPrice(primaryOracle);

        if (success) {
            _setPrice(price, roundId, updatedAt, address(primaryOracle));
            return;
        }

        // Primary failed – emit specific event before falling back.
        if (reason == FallbackReason.StalePrice) {
            emit StalePrice(updatedAt, address(primaryOracle));
        } else {
            emit FallbackTriggered(reason, address(primaryOracle));
        }

        // Attempt secondary oracle.
        (success, price, roundId, updatedAt, reason) = _fetchValidPrice(secondaryOracle);

        if (success) {
            _setPrice(price, roundId, updatedAt, address(secondaryOracle));
            return;
        }

        // Both oracles failed.
        emit BothOraclesFailed();
        revert BothOraclesFailedError();
    }

    // ============ View Functions ============

    /**
     * @notice Returns the last successfully validated price.
     * @return price The price in oracle decimals.
     * @return roundId The round ID from which the price was obtained.
     * @return updatedAt Timestamp of the price update.
     * @dev Reverts if no price has been set yet (contract just deployed).
     */
    function getPrice()
        external
        view
        returns (uint256 price, uint80 roundId, uint256 updatedAt)
    {
        if (!priceInitialized) revert NotInitialized();
        return (lastPrice, lastRoundId, lastUpdateTimestamp);
    }

    /**
     * @notice Convenience view that returns only the price (reverts if not set).
     * @return price The latest price.
     */
    function getLatestPrice() external view returns (uint256 price) {
        if (!priceInitialized) revert NotInitialized();
        return lastPrice;
    }

    // ============ Internal Functions ============

    /**
     * @dev Internal max staleness setter.
     * @param _newStaleness New staleness value in seconds.
     */
    function _setMaxStalenessInternal(uint256 _newStaleness) internal {
        uint256 oldStaleness = maxStaleness;
        maxStaleness = _newStaleness;
        emit MaxStalenessUpdated(_newStaleness, oldStaleness);
    }

    /**
     * @dev Internal function to set the latest price and update state.
     * @param _price Validated price.
     * @param _roundId Round ID from the oracle.
     * @param _updatedAt Timestamp of the oracle update.
     * @param _oracle Address of the oracle used.
     */
    function _setPrice(
        uint256 _price,
        uint80 _roundId,
        uint256 _updatedAt,
        address _oracle
    ) internal {
        lastPrice = _price;
        lastRoundId = _roundId;
        lastUpdateTimestamp = _updatedAt;
        priceInitialized = true;
        emit PriceUpdated(_price, _roundId, _updatedAt, _oracle);
    }

    /**
     * @dev Fetches a valid price from the provided Chainlink aggregator.
     *      Validates round completeness, positive price, and staleness.
     * @param _oracle The aggregator to query.
     * @return success Whether a valid price was obtained.
     * @return price The raw price from the oracle.
     * @return roundId The round ID.
     * @return updatedAt The timestamp of the round.
     * @return reason The reason if validation failed (FallbackReason.NotApplicable if success).
     */
    function _fetchValidPrice(
        AggregatorV3Interface _oracle
    )
        internal
        view
        returns (
            bool success,
            uint256 price,
            uint80 roundId,
            uint256 updatedAt,
            FallbackReason reason
        )
    {
        try _oracle.latestRoundData() returns (
            uint80 _roundId,
            int256 _answer,
            uint256 _startedAt,
            uint256 _updatedAt,
            uint80 _answeredInRound
        ) {
            roundId = _roundId;
            updatedAt = _updatedAt;

            // Round completeness check: answeredInRound must be >= roundId
            if (_answeredInRound < _roundId) {
                return (false, 0, roundId, updatedAt, FallbackReason.IncompleteRound);
            }

            // Price must be positive (strictly greater than zero)
            if (_answer <= 0) {
                return (false, 0, roundId, updatedAt, FallbackReason.InvalidPrice);
            }

            price = uint256(_answer);

            // Staleness check: updatedAt must be within maxStaleness
            if (block.timestamp - _updatedAt > maxStaleness) {
                return (false, price, roundId, updatedAt, FallbackReason.StalePrice);
            }

            return (true, price, roundId, updatedAt, FallbackReason.NotApplicable);
        } catch Error(string memory) {
            // Revert from the aggregator call
            return (false, 0, 0, 0, FallbackReason.ExternalCallFailed);
        } catch (bytes memory) {
            // Generic failure
            return (false, 0, 0, 0, FallbackReason.ExternalCallFailed);
        }
    }
}