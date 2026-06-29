// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title PriceOracle
 * @notice Fetches price from Chainlink feeds with staleness checks and fallback mechanism
 */
contract PriceOracle {
    AggregatorV3Interface public primaryOracle;
    AggregatorV3Interface public fallbackOracle;
    address public owner;
    uint256 public MAX_STALENESS = 3600; // 1 hour default

    event StalePrice(uint256 indexed lastUpdateTimestamp);
    event PrimaryOracleUpdated(address indexed newOracle);
    event FallbackOracleUpdated(address indexed newOracle);
    event MaxStalenessUpdated(uint256 newMaxStaleness);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(address _primaryOracle, address _fallbackOracle) {
        require(_primaryOracle != address(0), "Invalid primary oracle");
        require(_fallbackOracle != address(0), "Invalid fallback oracle");
        primaryOracle = AggregatorV3Interface(_primaryOracle);
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
        owner = msg.sender;
    }

    function setPrimaryOracle(address _primaryOracle) external onlyOwner {
        require(_primaryOracle != address(0), "Invalid primary oracle");
        primaryOracle = AggregatorV3Interface(_primaryOracle);
        emit PrimaryOracleUpdated(_primaryOracle);
    }

    function setFallbackOracle(address _fallbackOracle) external onlyOwner {
        require(_fallbackOracle != address(0), "Invalid fallback oracle");
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
        emit FallbackOracleUpdated(_fallbackOracle);
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        MAX_STALENESS = _maxStaleness;
        emit MaxStalenessUpdated(_maxStaleness);
    }

    function getPrice() external view returns (int256 price) {
        (bool primarySuccess, int256 primaryPrice) = _tryGetPrice(primaryOracle);
        
        if (primarySuccess) {
            return primaryPrice;
        }

        // Primary oracle failed, try fallback
        (bool fallbackSuccess, int256 fallbackPrice) = _tryGetPrice(fallbackOracle);
        
        require(fallbackSuccess, "Both oracles stale");
        
        return fallbackPrice;
    }

    function _tryGetPrice(AggregatorV3Interface oracle) internal view returns (bool success, int256 price) {
        try oracle.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // Check round completeness
            require(answeredInRound >= roundId, "Incomplete round");
            
            // Check for valid price
            require(answer > 0, "Invalid price");
            
            // Check staleness
            if (block.timestamp - updatedAt >= MAX_STALENESS) {
                emit StalePrice(updatedAt);
                return (false, 0);
            }
            
            return (true, answer);
        } catch {
            return (false, 0);
        }
    }
}
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
