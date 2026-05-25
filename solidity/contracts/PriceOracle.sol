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
    uint256 public constant MAX_STALENESS = 3600; // 1 hour in seconds
    
    address public primaryOracle;
    address public secondaryOracle;
    uint256 public maxStaleness = MAX_STALENESS;
    
    event StalePrice(address staleOracle, uint256 lastUpdatedAt);
    event MaxStalenessUpdated(uint256 oldMaxStaleness, uint256 newMaxStaleness);
    
    constructor(address _primaryOracle, address _secondaryOracle) {
        primaryOracle = _primaryOracle;
        secondaryOracle = _secondaryOracle;
    }
    
    function getLatestPrice(address token) public view returns (uint256) {
        AggregatorV3Interface priceFeed = AggregatorV3Interface(primaryOracle);
        (uint80 roundId, int256 price, , uint256 updatedAt, uint80 answeredInRound) = priceFeed.latestRoundData();
        
        // Check round completeness
        require(answeredInRound >= roundId, "Incomplete round");
        
        // Check for valid price
        require(price > 0, "Invalid price");
        
        // Check for staleness
        require(block.timestamp - updatedAt < maxStaleness, "Stale price");
        
        return uint256(price);
    }
    
    function updateOracles(address _primary, address _secondary) public onlyOwner {
        primaryOracle = _primary;
        secondaryOracle = _secondary;
    }
    
    function updateMaxStaleness(uint256 _maxStaleness) public onlyOwner {
        emit MaxStalenessUpdated(maxStaleness, _maxStaleness);
        maxStaleness = _maxStaleness;
    }
    
    function getLatestPriceWithFallback(address token) public view returns (uint256) {
        // Try primary oracle first
        AggregatorV3Interface primary = AggregatorV3Interface(primaryOracle);
        (uint80 roundId, int256 price, , uint256 updatedAt, uint80 answeredInRound) = primary.latestRoundData();
        
        // Validate round completeness
        require(answeredInRound >= roundId, "Primary oracle: Incomplete round");
        
        // Check for valid price
        require(price > 0, "Primary oracle: Invalid price");
        
        // Check if price is stale
        if (block.timestamp - updatedAt >= maxStaleness) {
            // Primary oracle is stale, try secondary oracle
            emit StalePrice(address(primary), updatedAt);
            AggregatorV3Interface secondary = AggregatorV3Interface(secondaryOracle);
            (, int256 secondaryPrice, , uint256 secondaryUpdatedAt, ) = secondary.latestRoundData();
            
            // Validate secondary oracle data
            require(uint80(secondary.answeredInRound()) >= secondary.answeredInRound(), "Secondary oracle: Incomplete round");
            require(secondaryPrice > 0, "Secondary oracle: Invalid price");
            require(block.timestamp - secondaryUpdatedAt < maxStaleness, "Both oracles are stale");
            
            return uint256(secondaryPrice);
        }
        
        // If we get here, primary oracle data is valid
        return uint256(price);
    }
}
}
