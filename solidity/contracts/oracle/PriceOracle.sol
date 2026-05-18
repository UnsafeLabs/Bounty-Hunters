// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PriceOracle
 * @notice Fix: Missing staleness check and fallback mechanism (#915)
 *
 * Problem: PriceOracle reads from Chainlink without checking
 * updatedAt timestamp, allowing stale/failed prices to be used.
 * No fallback when primary oracle fails.
 *
 * Solution: Staleness check, roundId completeness check,
 * fallback oracle, and heartbeat validation.
 */

import "@openzeppelin/contracts/access/Ownable.sol";

interface IChainlinkAggregator {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
}

contract PriceOracle is Ownable {
    struct OracleConfig {
        address aggregator;
        uint256 staleThreshold;    // Max seconds since last update
        uint8    decimals;
        bool     enabled;
    }

    mapping(address => OracleConfig) public primaryOracle;
    mapping(address => OracleConfig) public fallbackOracle;

    // Global heartbeat — max time between updates
    uint256 public globalStaleThreshold = 3600; // 1 hour default

    event PriceUpdated(address indexed token, uint256 price, bool fromFallback);
    event StalePriceDetected(address indexed token, uint256 updatedAt, uint256 threshold);
    event FallbackUsed(address indexed token, address fallbackAggregator);

    error StalePrice(address token, uint256 updatedAt, uint256 threshold);
    error InvalidRound(address token, uint80 roundId, uint80 answeredInRound);
    error NoOracleConfigured(address token);
    error NegativePrice(address token, int256 price);
    error OracleFailed(address token, string reason);

    /**
     * @notice Get price with staleness check + fallback
     */
    function getPrice(address token) external view returns (uint256 price) {
        // Try primary oracle
        (bool success, uint256 primaryPrice) = _getSafePrice(token, primaryOracle[token]);
        
        if (success) {
            return primaryPrice;
        }

        // Try fallback oracle
        (bool fallbackSuccess, uint256 fallbackPrice) = _getSafePrice(token, fallbackOracle[token]);
        
        if (fallbackSuccess) {
            return fallbackPrice;
        }

        revert OracleFailed(token, "Both primary and fallback oracles failed");
    }

    /**
     * @notice Internal: safely get price with all checks
     */
    function _getSafePrice(address token, OracleConfig storage config) 
        internal view returns (bool success, uint256 price) 
    {
        if (!config.enabled || config.aggregator == address(0)) {
            return (false, 0);
        }

        try IChainlinkAggregator(config.aggregator).latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // 1. Check answer is positive
            if (answer <= 0) {
                return (false, 0);
            }

            // 2. Staleness check
            uint256 threshold = config.staleThreshold > 0 
                ? config.staleThreshold 
                : globalStaleThreshold;
            
            if (block.timestamp - updatedAt > threshold) {
                emit StalePriceDetected(token, updatedAt, threshold);
                return (false, 0);
            }

            // 3. Round completeness: answeredInRound >= roundId
            if (answeredInRound < roundId) {
                return (false, 0);
            }

            // 4. Zero startedAt means round not started
            if (startedAt == 0) {
                return (false, 0);
            }

            // 5. Convert to 18 decimals
            uint8 decimals = config.decimals > 0 ? config.decimals : IChainlinkAggregator(config.aggregator).decimals();
            price = uint256(answer) * (10 ** (18 - decimals));
            success = true;
        } catch {
            return (false, 0);
        }
    }

    function setPrimaryOracle(
        address token,
        address aggregator,
        uint256 staleThreshold,
        uint8 decimals
    ) external onlyOwner {
        primaryOracle[token] = OracleConfig(aggregator, staleThreshold, decimals, true);
    }

    function setFallbackOracle(
        address token,
        address aggregator,
        uint256 staleThreshold,
        uint8 decimals
    ) external onlyOwner {
        fallbackOracle[token] = OracleConfig(aggregator, staleThreshold, decimals, true);
    }

    function setGlobalStaleThreshold(uint256 threshold) external onlyOwner {
        globalStaleThreshold = threshold;
    }
}
