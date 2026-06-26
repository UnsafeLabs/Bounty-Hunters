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

import "@openzeppelin/contracts/access/Ownable.sol";

interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

contract PriceOracle is Ownable {
    AggregatorV3Interface public primaryOracle;
    AggregatorV3Interface public fallbackOracle;
    uint256 public MAX_STALENESS = 3600; // 1 hour default

    event StalePrice(uint256 updatedAt);

    constructor(address _primaryOracle, address _fallbackOracle) {
        primaryOracle = AggregatorV3Interface(_primaryOracle);
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        MAX_STALENESS = _maxStaleness;
    }

    function setPrimaryOracle(address _primaryOracle) external onlyOwner {
        primaryOracle = AggregatorV3Interface(_primaryOracle);
    }

    function setFallbackOracle(address _fallbackOracle) external onlyOwner {
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
    }

    function _getValidPrice(AggregatorV3Interface oracle) internal view returns (int256, uint256) {
        (
            uint80 roundId,
            int256 price,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = oracle.latestRoundData();

        require(answeredInRound >= roundId, "Incomplete round");
        require(price > 0, "Invalid price");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");

        return (price, updatedAt);
    }

    function getPrice() external view returns (int256) {
        try this._tryPrimaryOracle() returns (int256 price) {
            return price;
        } catch {
            (int256 fallbackPrice, ) = _getValidPrice(fallbackOracle);
            return fallbackPrice;
        }
    }

    function _tryPrimaryOracle() external view returns (int256) {
        try this._getPrimaryPrice() returns (int256 price, uint256 updatedAt) {
            return price;
        } catch {
            revert("Primary oracle failed");
        }
    }

    function _getPrimaryPrice() external view returns (int256, uint256) {
        (int256 price, uint256 updatedAt) = _getValidPrice(primaryOracle);
        return (price, updatedAt);
    }
}
}
