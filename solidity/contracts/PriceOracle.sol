// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "hardhat/console.sol";

contract PriceOracle {
    uint256 public constant MAX_STALENESS = 3600;
    address public owner;
    address public primaryOracle;
    address public secondaryOracle;
    address public fallbackOracle;

    event StalePrice(address indexed oracle, uint256 timestamp);

    constructor(address _primaryOracle, address _fallbackOracle) {
        owner = msg.sender;
        primaryOracle = _primaryOracle;
        fallbackOracle = _fallbackOracle;
    }

    function getPrice(address token) public view returns (int256) {
        (bool success, int256 price) = _getPriceFromOracle(primaryOracle);
        if (!success) {
            (, int256 fallbackPrice) = _getPriceFromOracle(fallbackOracle);
            if (fallbackPrice == 0) {
                revert("Both oracles returned stale data");
            }
            emit StalePrice(primaryOracle, block.timestamp);
            return fallbackPrice;
        }
        return price;
    }

    function _getPriceFromOracle(address oracle) private view returns (bool success, int256 price) {
        AggregatorV3Interface priceFeed = AggregatorV3Interface(oracle);
        (uint80 roundId, int256 price, , uint256 updatedAt, ) = priceFeed.latestRoundData();
        if (block.timestamp - updatedAt > MAX_STALENESS) {
            return (false, 0);
        }
        if (price <= 0) {
            return (false, 0);
        }
        if (updatedAt < block.timestamp - MAX_STALENESS) {
            return (false, 0);
        }
        return (true, price);
    }

    function setPrimaryOracle(address _primaryOracle) public {
        require(msg.sender == owner, "Only owner can set primary oracle");
        primaryOracle = _primaryOracle;
    }

    function setFallbackOracle(address _fallbackOracle) public {
        require(msg.sender == owner, "Only owner can set fallback oracle");
        fallbackOracle = _fallbackOracle;
    }
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
