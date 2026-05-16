solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title PriceOracle
 * @notice Fetches price from a primary Chainlink feed with fallback to a secondary oracle.
 * @dev Validates data freshness, round completeness, and price positivity.
 *      Emits events for stale data and configuration changes.
 */
contract PriceOracle is Ownable {
    // --- State Variables ---

    /// @notice Primary Chainlink aggregator (source of truth).
    AggregatorV3Interface public primaryOracle;

    /// @notice Secondary oracle address used when primary data is stale.
    address public secondaryOracle;

    /// @notice Maximum allowed age for price data (in seconds).
    uint256 public maxStaleness;

    // --- Events ---

    /// @notice Emitted when primary oracle price is stale and fallback is used.
    /// @param updatedAt Timestamp of the last valid update from primary oracle.
    event StalePrice(uint256 indexed updatedAt);

    /// @notice Emitted when secondary oracle address is updated.
    /// @param newSecondary Address of the new secondary oracle.
    event SecondaryOracleUpdated(address indexed newSecondary);

    /// @notice Emitted when max staleness parameter is changed.
    /// @param newStaleness New staleness duration in seconds.
    event MaxStalenessUpdated(uint256 newStaleness);

    // --- Modifiers ---

    modifier validOracle(address oracle) {
        require(oracle != address(0), "Oracle address is zero");
        require(oracle.code.length > 0, "Oracle is not a contract");
        _;
    }

    // --- Constructor ---

    /**
     * @notice Initializes the PriceOracle with primary and secondary oracles.
     * @param _primaryOracle Address of the primary Chainlink aggregator.
     * @param _secondaryOracle Address of the fallback oracle (can be zero initially).
     * @param _maxStaleness Maximum staleness in seconds (e.g., 3600 for 1 hour).
     */
    constructor(
        address _primaryOracle,
        address _secondaryOracle,
        uint256 _maxStaleness
    ) validOracle(_primaryOracle) {
        require(_maxStaleness > 0, "Staleness must be > 0");
        primaryOracle = AggregatorV3Interface(_primaryOracle);
        secondaryOracle = _secondaryOracle;
        maxStaleness = _maxStaleness;
    }

    // --- External Functions ---

    /**
     * @notice Returns the latest valid price from primary or fallback oracle.
     * @dev Reverts if both oracles provide stale, negative, or incomplete data.
     * @return The price as an unsigned integer (scaled by oracle decimals).
     */
    function getPrice() external returns (uint256) {
        (uint80 roundId, int256 price, , uint256 updatedAt, uint80 answeredInRound) =
            primaryOracle.latestRoundData();

        _validatePriceData(roundId, price, updatedAt, answeredInRound);

        // If data is not stale, return it
        if (block.timestamp - updatedAt < maxStaleness) {
            return uint256(price);
        }

        // Primary is stale – emit event and try fallback
        emit StalePrice(updatedAt);

        require(secondaryOracle != address(0), "No secondary oracle configured");
        require(secondaryOracle.code.length > 0, "Secondary oracle not a contract");

        AggregatorV3Interface secondary = AggregatorV3Interface(secondaryOracle);
        (roundId, price, , updatedAt, answeredInRound) = secondary.latestRoundData();

        _validatePriceData(roundId, price, updatedAt, answeredInRound);

        require(block.timestamp - updatedAt < maxStaleness, "Both oracles stale");

        return uint256(price);
    }

    /**
     * @notice Updates the secondary oracle address.
     * @param _secondaryOracle New fallback oracle address (can be zero to disable fallback).
     */
    function setSecondaryOracle(address _secondaryOracle) external onlyOwner {
        if (_secondaryOracle != address(0)) {
            require(_secondaryOracle.code.length > 0, "Not a contract");
        }
        secondaryOracle = _secondaryOracle;
        emit SecondaryOracleUpdated(_secondaryOracle);
    }

    /**
     * @notice Updates the maximum staleness threshold.
     * @param _maxStaleness New staleness duration in seconds.
     */
    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Staleness must be > 0");
        maxStaleness = _maxStaleness;
        emit MaxStalenessUpdated(_maxStaleness);
    }

    // --- Internal Functions ---

    /**
     * @notice Validates price data from an aggregator.
     * @dev Reverts if round is incomplete, price is non-positive, or data is too old.
     * @param roundId Current round ID.
     * @param price Price from the aggregator.
     * @param updatedAt Timestamp of the last update.
     * @param answeredInRound Round ID in which the answer was computed.
     */
    function _validatePriceData(
        uint80 roundId,
        int256 price,
        uint256 updatedAt,
        uint80 answeredInRound
    ) internal pure {
        require(answeredInRound >= roundId, "Incomplete round");
        require(price > 0, "Invalid price");
        require(updatedAt > 0, "No update yet");
    }
}