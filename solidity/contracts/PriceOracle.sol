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
pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract PriceOracle is Ownable {
    AggregatorV3Interface public primaryOracle;
    AggregatorV3Interface public fallbackOracle;
    uint256 public maxStaleness = 3600; // 1 hour default
    
    event StalePrice(address primaryOracle, uint256 primaryTimestamp, address fallbackOracle, uint256 fallbackTimestamp);
    
    constructor(address _primaryOracle, address _fallbackOracle) {
        primaryOracle = AggregatorV3Interface(_primaryOracle);
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
    }
    
    function setMaxStaleness(uint256 _maxStaleness) public onlyOwner {
        maxStaleness = _maxStaleness;
    }
    
    function getPrice(address _oracle) public view returns (int) {
        AggregatorV3Interface oracle = AggregatorV3Interface(_oracle);
        (,int price,,uint256 updatedAt,) = oracle.latestRoundData();
        
        // Check round completeness
        require(updatedAt > 0, "Invalid timestamp");
        
        // Check for stale price
        if (block.timestamp - updatedAt > maxStaleness) {
            // Try fallback oracle
            (,price,,updatedAt,) = fallbackOracle.latestRoundData();
            emit StalePrice(address(primaryOracle), updatedAt, address(fallbackOracle), updatedAt);
            return price;
        }
        
        // Check price validity
        require(price > 0, "Invalid price");
        
        return price;
    }
    
    function getPriceWithFallback(address _primaryOracle, address _fallbackOracle) public view returns (int) {
        AggregatorV3Interface primary = AggregatorV3Interface(_primaryOracle);
        AggregatorV3Interface fallback = AggregatorV3Interface(_fallbackOracle);
        
        (,int price,,uint256 updatedAt,) = primary.latestRoundData();
        
        // Check round completeness
        require(updatedAt > 0, "Invalid timestamp");
        
        // If primary oracle data is stale, use fallback
        if (block.timestamp - updatedAt > maxStaleness) {
            (,price,,updatedAt,) = fallback.latestRoundData();
            return price;
        }
        
        // Check price validity
        require(price > 0, "Invalid price");
        
        return price;
    }
}

interface PriceOracleInterface {
    function primaryOracle() external view returns (AggregatorV3Interface);
    function fallbackOracle() external view returns (AggregatorV3Interface);
    function maxStaleness() external view returns (uint256);
    function setMaxStaleness(uint256 _maxStaleness) external;
    function getPrice(address _oracle) external view returns (int256);
    function getPriceWithFallback(address _primaryOracle, address _fallbackOracle) external view returns (int256);
}

contract PriceOracle is PriceOracleInterface, Ownable {
    AggregatorV3Interface public primaryOracle;
    AggregatorV3Interface public fallbackOracle;
    uint256 public maxStaleness;
    
    constructor(address _primaryOracle, address _fallbackOracle) {
        primaryOracle = AggregatorV3Interface(_primaryOracle);
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
    }
    
    function setMaxStaleness(uint256 _maxStaleness) public onlyOwner {
        maxStaleness = _maxStalStale;
    }
}
}
