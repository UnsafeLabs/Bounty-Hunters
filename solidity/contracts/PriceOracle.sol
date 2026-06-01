// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/AggregatorV3Interface.sol";

contract PriceOracle {
    AggregatorV3Interface public primaryFeed;
    AggregatorV3Interface public fallbackFeed;
    address public owner;
    uint256 public maxStaleness = 3600;

    event StalePrice(uint256 timestamp);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    function _getLatestPriceData() internal view returns (int256, bool, uint256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        require(price > 0, "Invalid price");
        require(updatedAt != 0 && updatedAt <= block.timestamp, "Round not complete or invalid time");
        require(answeredInRound >= roundId, "Incomplete round");

        if (block.timestamp - updatedAt > maxStaleness) {
            (
                uint80 fbRoundId,
                int256 fbPrice,
                ,
                uint256 fbUpdatedAt,
                uint80 fbAnsweredInRound
            ) = fallbackFeed.latestRoundData();

            require(fbPrice > 0, "Invalid price");
            require(fbUpdatedAt != 0 && fbUpdatedAt <= block.timestamp, "Round not complete or invalid time");
            require(fbAnsweredInRound >= fbRoundId, "Incomplete round");
            require(block.timestamp - fbUpdatedAt <= maxStaleness, "Stale price");
            
            return (fbPrice, true, updatedAt);
        }

        return (price, false, updatedAt);
    }

    function getLatestPrice() external view returns (int256) {
        (int256 price, , ) = _getLatestPriceData();
        return price;
    }

    function getLatestPriceAndEmit() external returns (int256) {
        (int256 price, bool isStale, uint256 updatedAt) = _getLatestPriceData();
        if (isStale) {
            emit StalePrice(updatedAt);
        }
        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        maxStaleness = _maxStaleness;
    }
}
