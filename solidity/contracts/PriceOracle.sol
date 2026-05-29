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
   uint256 public constant MAX_STALENESS = 3600; // 1 hour staleness threshold
   address public owner;
   address public fallbackOracle;
   uint256 public stalenessThreshold;
   
   event StalePrice(address primaryOracle, uint256 lastUpdatedAt);
   
   constructor(address _fallbackOracle) {
       owner = msg.sender;
       fallbackOracle = _fallbackOracle;
       stalenessThreshold = MAX_STALENESS;
   }
   
   function setStalenessThreshold(uint256 _threshold) public {
       require(msg.sender == owner, "Only owner can set threshold");
       stalenessThreshold = _threshold;
   }
   
   function getPrice(address token) public view returns (uint256) {
       (uint80 roundId, int256 price, uint256 updatedAt, uint256 answeredInRound) = this.getLatestPriceData(token);
       
       // Check for valid round completeness
       require(answeredInRound >= roundId, "Incomplete round");
       
       // Check for negative prices
       require(price > 0, "Invalid price");
       
       // Check for staleness
       if (block.timestamp - updatedAt < stalenessThreshold) {
           return uint256(price);
       } else {
           // Price is stale, try fallback oracle
           emit StalePrice(token, updatedAt);
           return this.getFallbackPrice(token);
       }
   }
   
   function getLatestPriceData(address token) public view returns (uint80, int256, uint256, uint256) {
       // Mock implementation - in reality would call Chainlink price feeds
       return (0, 0, 0, 0);
   }
   
   function getFallbackPrice(address token) public view returns (uint256) {
       // Mock implementation for fallback oracle
       return 0;
   }
}
