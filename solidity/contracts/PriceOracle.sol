// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract PriceOracle {
    AggregatorV3Interface public primaryOracle;
    AggregatorV3Interface public fallbackOracle;
    uint256 public MAX_STALENESS;
    address public owner;
    
    event StalePrice(uint256 lastUpdate);
    
    constructor(AggregatorV3Interface _primaryOracle, AggregatorV3Interface _fallbackOracle) {
        primaryOracle = _primaryOracle;
        fallbackOracle = _fallbackOracle;
        owner = msg.sender;
        MAX_STALENESS = 3600; // 1 hour default
    }
    
    function setMaxStaleness(uint256 _maxStaleness) public {
        require(msg.sender == owner, "Only owner can set MAX_STALENESS");
        MAX_STALENESS = _maxStal0608
    }
    
    function getLatestPrice() public view returns (uint256) {
        (
            uint80 roundId,
            int256 price,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryOracle.latestRoundData();
        
        // Check round completeness
        require(answeredInRound >= roundId, "Incomplete round");
        
        // Check for negative prices
        require(price > 0, "Invalid price");
        
        // Check for staleness
        if (block.timestamp - updatedAt > MAX_STALENESS) {
            // Primary oracle is stale, try fallback
            (
                uint80 _roundId,
                int256 _price,
                uint256 _startedAt,
                uint256 _updatedAt,
                uint80 _answeredInRound
            ) = fallbackOracle.latestRoundData();
            
            emit StalePrice(updatedAt);
            
            // Check if fallback data is also stale
            if (block.timestamp - _updatedAt > MAX_STALENESS) {
                revert("Both oracles return stale data");
            }
            
            // Use fallback oracle data
            return _price;
        }
        
        return uint256(price);
    }
    
    function getLatestPriceWithValidation() public view returns (uint256) {
        return getLatestPrice();
    }
}

// Fallback mechanism that queries primary oracle and falls back if needed
function getLatestPrice() public view returns (uint256) {
    (
        uint80 roundId,
        int256 price,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) = primaryOracle.latestRoundData();
    
    // Check round completeness
    require(answeredInRound >= roundId, "Incomplete round");
    
    // Check for negative prices
    require(price > 0, "Invalid price");
    
    // Check for staleness
    if (block.timestamp - updatedAt > MAX_STALENESS) {
        // Primary oracle is stale, try fallback
        (
            uint80 _roundId,
            int256 _price,
            uint256 _startedAt,
            uint256 _updatedAt,
            uint80 _answeredInRound
        ) = fallbackOracle.latestRoundData();
        
        emit StalePrice(updatedAt);
        
        // Check if fallback data is also stale
        if (block.timestamp - _updatedAt > MAX_STALENESS) {
            revert("Both oracles return stale data");
        }
        
        // Use fallback oracle data
        return uint256(_price);
    }
    
    return uint256(price);
}
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
}
