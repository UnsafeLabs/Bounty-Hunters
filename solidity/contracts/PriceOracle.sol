// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract PriceOracle is Ownable {
    AggregatorV3Interface public immutable primaryOracle;
    AggregatorV3Interface public fallbackOracle;
    uint256 public MAX_STALENESS = 3600; // 1 hour
    
    event StalePrice(uint256 timestamp, address oracle);
    event OracleUpdated(address indexed newOracle, bool isPrimary);
    
    constructor(address _primaryOracle, address _fallbackOracle) Ownable(msg.sender) {
        require(_primaryOracle != address(0), "Invalid primary oracle");
        require(_fallbackOracle != address(0), "Invalid fallback oracle");
        primaryOracle = AggregatorV3Interface(_primaryOracle);
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
    }
    
    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        MAX_STALENESS = _maxStaleness;
    }
    
    function setFallbackOracle(address _fallbackOracle) external onlyOwner {
        require(_fallbackOracle != address(0), "Invalid fallback oracle");
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
        emit OracleUpdated(_fallbackOracle, false);
    }
    
    function getPrice() external view returns (int256) {
        (, int256 price, , uint256 updatedAt, uint80 answeredInRound) = primaryOracle.latestRoundData();
        uint256 roundId = uint256(answeredInRound);
        
        // Check round completeness
        require(answeredInRound >= roundId, "Incomplete round");
        
        // Check for valid price
        require(price > 0, "Invalid price");
        
        // Check staleness
        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            // Try fallback oracle
            return _getPriceFromFallback(updatedAt);
        }
        
        return price;
    }
    
    function _getPriceFromFallback(uint256 primaryUpdatedAt) internal view returns (int256) {
        (, int256 price, , uint256 updatedAt, uint80 answeredInRound) = fallbackOracle.latestRoundData();
        uint256 roundId = uint256(answeredInRound);
        
        require(answeredInRound >= roundId, "Fallback incomplete round");
        require(price > 0, "Fallback invalid price");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Both oracles stale");
        
        emit StalePrice(primaryUpdatedAt, address(fallbackOracle));
        return price;
    }
    
    function getPrimaryOracle() external view returns (address) {
        return address(primaryOracle);
    }
    
    function getFallbackOracle() external view returns (address) {
        return address(fallbackOracle);
    }
}