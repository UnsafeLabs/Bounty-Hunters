solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title PriceOracle
 * @notice Fetches asset prices from a primary Chainlink oracle with fallback to a secondary oracle.
 * @dev All price data is validated for freshness (configurable staleness threshold), round completeness,
 *      positive value, and non-zero timestamp. The contract is designed with defence-in-depth:
 *      - Reverts on zero/negative prices
 *      - Reverts on incomplete rounds (answeredInRound < roundId)
 *      - Reverts if the oracle has never been updated (updatedAt == 0)
 *      - Falls back to a secondary oracle when primary data is stale
 *      - Reverts if both oracles provide stale or invalid data
 *      - Staleness threshold is owner-adjustable
 *      - Emits `StalePrice` event on fallback for off-chain monitoring
 *
 * @custom:security This contract does not maintain state that can be exploited; it only reads from trusted oracles.
 *                  The primary and secondary oracle addresses are immutable and cannot be changed after deployment,
 *                  which reduces attack surface.
 */
contract PriceOracle is Ownable {
    // ----------------------------------------------------------------------
    // Custom Errors (gas-efficient alternative to revert strings)
    // ----------------------------------------------------------------------

    /// @dev Thrown when a price is zero or negative.
    error InvalidPrice();

    /// @dev Thrown when the Chainlink round is incomplete (answeredInRound < roundId).
    error RoundNotComplete();

    /// @dev Thrown when the primary oracle data is stale (older than maxStaleness).
    /// @param updatedAt The timestamp of the last update from the oracle.
    /// @param oracle The address of the oracle that returned stale data.
    error StaleData(uint256 updatedAt, address oracle);

    /// @dev Thrown when both primary and secondary oracles return stale or invalid data.
    error BothOraclesStale();

    /// @dev Thrown when the oracle has never been updated (updatedAt == 0).
    error OracleNotInitialized();

    // ----------------------------------------------------------------------
    // Events (on-chain logging)
    // ----------------------------------------------------------------------

    /// @notice Emitted when the primary oracle data is stale and the contract falls back to the secondary oracle.
    /// @param primaryUpdatedAt Timestamp of the primary oracle's last update.
    /// @param primaryOracle Address of the primary oracle.
    event StalePrice(uint256 indexed primaryUpdatedAt, address indexed primaryOracle);

    /// @notice Emitted when the staleness threshold is updated by the owner.
    /// @param newStaleness The new threshold in seconds (must be > 0).
    event MaxStalenessUpdated(uint256 indexed newStaleness);

    // ----------------------------------------------------------------------
    // Constants
    // ----------------------------------------------------------------------

    /// @dev Minimum allowed staleness threshold (1 second) to prevent accidental zero-value updates.
    uint256 public constant MIN_STALENESS = 1;

    // ----------------------------------------------------------------------
    // State Variables
    // ----------------------------------------------------------------------

    /// @notice Primary Chainlink aggregator (source of truth when fresh).
    AggregatorV3Interface public immutable primaryOracle;

    /// @notice Secondary Chainlink aggregator (fallback when primary is stale).
    AggregatorV3Interface public immutable secondaryOracle;

    /// @notice Maximum allowed age of price data in seconds. Configurable by the owner.
    /// @dev Must be >= MIN_STALENESS.
    uint256 public maxStaleness;

    // ----------------------------------------------------------------------
    // Constructor
    // ----------------------------------------------------------------------

    /**
     * @notice Initializes the oracle pair and staleness threshold.
     * @dev Both oracle addresses must be non-zero and the staleness threshold must be >= 1 second.
     * @param _primaryOracle Address of the primary Chainlink aggregator.
     * @param _secondaryOracle Address of the secondary Chainlink aggregator.
     * @param _maxStaleness Maximum staleness in seconds (e.g., 3600 for 1 hour). Must be >= 1.
     */
    constructor(
        address _primaryOracle,
        address _secondaryOracle,
        uint256 _maxStaleness
    ) Ownable(msg.sender) {
        if (_primaryOracle == address(0)) revert ZeroAddress("primaryOracle");
        if (_secondaryOracle == address(0)) revert ZeroAddress("secondaryOracle");
        if (_maxStaleness < MIN_STALENESS) revert InvalidStaleness(_maxStaleness);

        primaryOracle = AggregatorV3Interface(_primaryOracle);
        secondaryOracle = AggregatorV3Interface(_secondaryOracle);
        maxStaleness = _maxStaleness;
    }

    // ----------------------------------------------------------------------
    // External Functions
    // ----------------------------------------------------------------------

    /**
     * @notice Fetches the latest asset price from the primary oracle, with automatic fallback.
     * @dev Reverts if:
     *      - Primary oracle provides stale data and secondary also provides stale/invalid data
     *      - Either oracle returns zero/negative price
     *      - Either oracle's round is incomplete (answeredInRound < roundId)
     *      - Either oracle has never been initialized (updatedAt == 0)
     * @return price The current asset price as an int256 (always > 0).
     */
    function getPrice() external view returns (int256 price) {
        (price, uint256 updatedAt) = _validateAndGetPrice(primaryOracle);

        // Check freshness of primary data
        if (block.timestamp - updatedAt >= maxStaleness) {
            emit StalePrice(updatedAt, address(primaryOracle));

            // Fallback to secondary oracle
            (int256 secondaryPrice, uint256 secondaryUpdatedAt) = _validateAndGetPrice(secondaryOracle);

            if (block.timestamp - secondaryUpdatedAt >= maxStaleness) {
                revert BothOraclesStale();
            }

            price = secondaryPrice;
        }
    }

    /**
     * @notice Updates the maximum staleness threshold.
     * @dev Only the contract owner can call this function.
     * @param _newStaleness New staleness threshold in seconds. Must be >= 1.
     */
    function setMaxStaleness(uint256 _newStaleness) external onlyOwner {
        if (_newStaleness < MIN_STALENESS) revert InvalidStaleness(_newStaleness);
        maxStaleness = _newStaleness;
        emit MaxStalenessUpdated(_newStaleness);
    }

    // ----------------------------------------------------------------------
    // Internal Functions
    // ----------------------------------------------------------------------

    /**
     * @notice Validates round completeness, oracle initialization, and positive price for a given oracle.
     * @dev Performs a single `latestRoundData` call and validates:
     *      - `updatedAtRaw != 0` (oracle has been initialized)
     *      - `answeredInRound >= roundId` (round is complete)
     *      - `answer > 0` (price is positive)
     * @param oracle The Chainlink aggregator to query.
     * @return price The valid price (> 0).
     * @return updatedAt The timestamp of the last update (for staleness check).
     */
    function _validateAndGetPrice(AggregatorV3Interface oracle) internal view returns (int256 price, uint256 updatedAt) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAtRaw,
            uint80 answeredInRound
        ) = oracle.latestRoundData();

        // Ensure the oracle has been initialized (non-zero timestamp)
        if (updatedAtRaw == 0) {
            revert OracleNotInitialized();
        }

        // Validate round completeness
        if (answeredInRound < roundId) {
            revert RoundNotComplete();
        }

        // Validate price is positive
        if (answer <= 0) {
            revert InvalidPrice();
        }

        return (answer, updatedAtRaw);
    }

    // ----------------------------------------------------------------------
    // Additional Error Definitions (for cleaner revert messages)
    // ----------------------------------------------------------------------

    /// @dev Thrown when an address parameter is zero.
    error ZeroAddress(string name);

    /// @dev Thrown when the staleness threshold is below the minimum.
    /// @param staleness The invalid staleness value.
    error InvalidStaleness(uint256 staleness);
}