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

contract PriceOracle {
    event StalePrice(address indexed oracle, uint256 updatedAt);
    
    AggregatorV3Interface public primaryOracle;
    AggregatorV3Interface public fallbackOracle;
    uint256 public maxStaleness;
    address public owner;
    
    constructor(
        address _primaryOracle,
        address _fallbackOracle,
        uint256 _maxStaleness
    ) {
        require(_primaryOracle != address(0), "Invalid primary oracle");
        require(_fallbackOracle != address(0), "Invalid fallback oracle");
        
        primaryOracle = AggregatorV3Interface(_primaryOracle);
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
        maxStaleness = _maxStaleness;
        owner = msg.sender;
    }
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    function getPrice() public view returns (int256) {
        return _getValidPrice(primaryOracle, fallbackOracle);
    }
    
    function getPrimaryPrice() public view returns (int256) {
        return _getValidPriceFromOracle(primaryOracle);
    }
    
    function getFallbackPrice() public view returns (int256) {
        return _getValidPriceFromOracle(fallbackOracle);
    }
    
    function _getValidPrice(AggregatorV3Interface _primary, AggregatorV3Interface _fallback) internal view returns (int256) {
        (uint80 roundId, int256 price, , uint256 updatedAt, uint80 answeredInRound) = _primary.latestRoundData();
        
        // Check round completeness
        if (answeredInRound < roundId) {
            emit StalePrice(address(_primary), updatedAt);
            return _getValidPriceFromOracle(_fallback);
        }
        
        // Check for negative or zero prices
        require(price > 0, "Invalid price");
        
        // Check for staleness
        if (block.timestamp - updatedAt >= maxStaleness) {
            emit StalePrice(address(_primary), updatedAt);
            return _getValidPriceFromOracle(_fallback);
        }
        
        return price;
    }
    
    function _getValidPriceFromOracle(AggregatorV3Interface _oracle) internal view returns (int256) {
        (uint80 roundId, int256 price, , uint256 updatedAt, uint80 answeredInRound) = _oracle.latestRoundData();
        
        // Check round completeness
        require(answeredInRound >= roundId, "Incomplete round");
        
        // Check for negative or zero prices
        require(price > 0, "Invalid price");
        
        // Check for staleness
        require(block.timestamp - updatedAt < maxStaleness, "Stale price");
        
        return price;
    }
    
    function setMaxStaleness(uint256 _maxStaleness) public onlyOwner {
        maxStaleness = _maxStaleness;
    }
    
    function setPrimaryOracle(address _primaryOracle) public onlyOwner {
        require(_primaryOracle != address(0), "Invalid primary oracle");
        primaryOracle = AggregatorV3Interface(_primaryOracle);
    }
    
    function setFallbackOracle(address _fallbackOracle) public onlyOwner {
        require(_fallbackOracle != address(0), "Invalid fallback oracle");
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
    }
}
}
