// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PriceOracle
 * @dev Fetches prices from Chainlink with staleness checks and fallback mechanism
 */
contract PriceOracle is Ownable {
    AggregatorV3Interface public primaryOracle;
    AggregatorV3Interface public fallbackOracle;
    uint256 public maxStaleness = 3600; // 1 hour default

    event StalePrice(address indexed oracle, uint256 lastUpdateTimestamp);
    event MaxStalenessUpdated(uint256 newMaxStaleness);

    constructor(address _primaryOracle, address _fallbackOracle) {
        require(_primaryOracle != address(0), "Invalid primary oracle");
        require(_fallbackOracle != address(0), "Invalid fallback oracle");
        primaryOracle = AggregatorV3Interface(_primaryOracle);
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
    }

    /**
     * @dev Fetches latest price with staleness check and fallback
     * @return price The latest valid price
     */
    function getLatestPrice() external view returns (int256 price) {
        (int256 primaryPrice, uint256 primaryUpdatedAt) = _getPriceFromOracle(primaryOracle);
        
        // Check if primary oracle price is fresh
        if (block.timestamp - primaryUpdatedAt < maxStaleness) {
            require(primaryPrice > 0, "Invalid price");
            return primaryPrice;
        }

        // Primary oracle is stale, emit event and try fallback
        emit StalePrice(address(primaryOracle), primaryUpdatedAt);
        
        (int256 fallbackPrice, uint256 fallbackUpdatedAt) = _getPriceFromOracle(fallbackOracle);
        
        // Check if fallback oracle price is fresh
        require(
            block.timestamp - fallbackUpdatedAt < maxStaleness,
            "Stale price: both oracles returned stale data"
        );
        require(fallbackPrice > 0, "Invalid price");
        
        return fallbackPrice;
    }

    /**
     * @dev Internal function to fetch price from oracle with round completeness check
     * @param oracle The oracle to fetch from
     * @return price The price from the oracle
     * @return updatedAt The timestamp of the last update
     */
    function _getPriceFromOracle(AggregatorV3Interface oracle)
        internal
        view
        returns (int256 price, uint256 updatedAt)
    {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 _updatedAt,
            uint80 answeredInRound
        ) = oracle.latestRoundData();

        // Validate round completeness
        require(answeredInRound >= roundId, "Incomplete round");
        
        return (answer, _updatedAt);
    }

    /**
     * @dev Set max staleness threshold
     * @param _maxStaleness New staleness threshold in seconds
     */
    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Max staleness must be positive");
        maxStaleness = _maxStaleness;
        emit MaxStalenessUpdated(_maxStaleness);
    }

    /**
     * @dev Update fallback oracle address
     * @param _fallbackOracle New fallback oracle address
     */
    function setFallbackOracle(address _fallbackOracle) external onlyOwner {
        require(_fallbackOracle != address(0), "Invalid fallback oracle");
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
    }
}
