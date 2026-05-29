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
    address public owner;
    uint256 public MAX_STALENESS = 3600;

    event PriceQueried(int256 price, uint256 timestamp);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    // BUG: No staleness check on updatedAt
    // BUG: No check for negative/zero price
    // BUG: No round completeness validation
    // BUG: No fallback oracle
    function getLatestPrice() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        // Missing: require(price > 0)
        // Missing: require(answeredInRound >= roundId)
        // Missing: require(block.timestamp - updatedAt < MAX_STALENESS)

        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract PriceOracle is Ownable {
    uint256 public constant MAX_STALENESS = 3600;
    
    AggregatorV3Interface public primaryOracle;
    AggregatorV3Interface public secondaryOracle;
    
    event StalePrice(address indexed primaryOracle, uint256 lastUpdated);
    
    constructor(address _primaryOracle, address _secondaryOracle) {
        primaryOracle = AggregatorV3Interface(_primaryOracle);
        secondaryOracle = AggregatorV3Interface(_secondaryOracle);
    }
    
    function getPrice(address token) external view returns (uint256) {
        return _getLatestPrice(primaryOracle);
    }
    
    function _getLatestPrice(AggregatorV3Interface priceFeed) internal view returns (uint256) {
        (uint80 roundId, int256 price, uint256 updatedAt, uint80 answeredInRound) = latestRoundData(priceFeed);
        
        // Validate round completeness
        require(answeredInRound >= roundId, "Incomplete round");
        
        // Validate price
        require(price > 0, "Invalid price");
        
        // Check staleness
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");
        
        return uint256(price);
    }
    
    function latestRoundData(AggregatorV3Interface feed) internal view returns (uint80, int256, uint256, uint80) {
        return feed.latestRoundData();
    }
    
    function getLatestPriceWithFallback() external view returns (uint256) {
        return _getPriceWithFallback();
    }
    
    function _getPriceWithFallback() internal view returns (uint256) {
        (uint80 roundId, int256 price, uint256 updatedAt, uint80 answeredInRound) = latestRoundData(primaryOracle);
        
        // Validate round completeness
        require(answeredInRound >= roundId, "Incomplete round");
        
        // Validate price
        require(price > 0, "Invalid price");
        
        // Check staleness
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");
        
        return uint256(price);
    }
    
    function getLatestPriceWithFallbackSecondary() external view returns (uint256) {
        return _getLatestPrice(primaryOracle);
    }
    
    function _getPriceWithFallback() internal view returns (uint256) {
        (uint80 roundId, int256 price, uint256 updatedAt, uint80 answeredInRound) = latestRoundData(primaryOracle);
        
        // Validate round completeness
        require(answeredInRound >= roundId, "Incomplete round");
        
        // Validate price
        require(price > 0, "Invalid price");
        
        // Check staleness and use fallback if needed
        if (block.timestamp - updatedAt >= MAX_STALENESS) {
            emit StalePrice(address(primaryOracle), updatedAt);
            return getLatestPriceWithFallbackSecondary();
        }
        
        return uint256(price);
    }
    
    function getLatestPriceWithFallbackSecondary() internal view returns (uint256) {
        (uint80 roundId, int256 price, uint256 updatedAt, uint80 answeredInRound) = latestRoundData(secondaryOracle);
        
        // Validate round completeness
        require(answeredInRound >= roundId, "Incomplete round");
        require(price > 0, "Invalid price");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");
        return uint256(price);
    }
}
}
