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
import "@chainlink/contracts/src/v0.8/interfaces/FeedRegistryInterface.sol";
import "@ chainlink/contracts/src/v0.8/Denominations.sol";

contract PriceOracle {
    address public owner;
    address public primaryOracle;
    address public secondaryOracle;
    uint256 public MAX_STALENESS;
    
    mapping(address => uint256) public maxStalenessMap;
    
    event StalePrice(address indexed oracle, uint256 timestamp);
    
    constructor(address _primaryOracle, address _secondaryOracle) {
        owner = msg.sender;
        primaryOracle = _primaryOracle;
        secondaryOracle = _secondaryOracle;
        MAX_STALENESS = 3600; // 1 hour default
    }
    
    function setMaxStaleness(uint256 _maxStaleness) public {
        require(msg.sender == owner, "Only owner can set max staleness");
        MAX_STALENESS = _maxStaleness;
    }
    
    function setPrimaryOracle(address _oracle) public {
        require(msg.sender == owner, "Only owner can set primary oracle");
        primaryOracle = _oracle;
    }
    
    function setSecondaryOracle(address _oracle) public {
        require(msg.sender == owner, "Only owner can set secondary oracle");
        secondaryOracle = _oracle;
    }
    
    function getLatestPrice(address token) public returns (uint256) {
        // First try primary oracle
        AggregatorV3Interface primary = AggregatorV3Interface(primaryOracle);
        (, int256 price, , uint256 updatedAt, ) = primary.latestRoundData();
        
        // Check if price is valid and not stale
        require(price > 0, "Invalid price");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");
        require(updatedAt <= block.timestamp, "Invalid timestamp");
        
        // Check round completeness
        (uint80 roundId, int256 answer, , uint256 updatedAtPrimary, ) = primary.latestRoundData();
        require(answer > 0, "Invalid price");
        if (block.timestamp - updatedAtPrimary >= MAX_STALENESS) {
            // Primary oracle is stale, try secondary
            emit StalePrice(primaryOracle, updatedAtPrimary);
            AggregatorV3Interface secondary = AggregatorV3Interface(secondaryOracle);
            (, int256 secondaryPrice, , uint256 updatedAtSecondary, ) = secondary.latestRoundData();
            require(secondaryPrice > 0, "Secondary oracle returned invalid price");
            require(block.timestamp - updatedAtSecondary < MAX_STALENESS, "Secondary price is stale");
            return uint256(secondaryPrice);
        }
        
        // Check if the price is from a complete round
        (uint80 roundId, int256 answer, , uint256 updatedAt, ) = primary.latestRoundData();
        require(answer > 0, "Invalid price");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");
        require(updatedAt <= block.timestamp, "Invalid timestamp");
        
        return uint256(answer);
    }
    
    function getLatestPriceWithToken(address token) public returns (uint256) {
        // First try primary oracle
        AggregatorV3Interface primary = AggregatorV3Interface(primaryOracle);
        (, int256 primaryPrice, , uint256 updatedAtPrimary, ) = primary.latestRoundData();
        
        // Check if price is valid and not stale
        require(primaryPrice > 0, "Invalid price");
        require(block.timestamp - updatedAtPrimary < MAX_STALENESS, "Stale price");
        
        // Check round completeness
        (uint80 roundId, int256 answer, , uint256 updatedAt, ) = primary.latestRoundData();
        require(answer > 0, "Invalid price");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");
        
        return uint256(answer);
    }
}
}
