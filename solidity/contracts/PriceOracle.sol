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
    AggregatorV3Interface public secondaryFeed;
    address public owner;
    uint256 public MAX_STALENESS = 3600;

    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(uint256 indexed roundTimestamp);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    function setSecondaryFeed(address _secondaryFeed) external {
        require(msg.sender == owner, "Not owner");
        secondaryFeed = AggregatorV3Interface(_secondaryFeed);
    }

    function getLatestPrice() external returns (int256) {
        // Attempt primary feed
        try primaryFeed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            if (price > 0 && answeredInRound >= roundId && block.timestamp - updatedAt < MAX_STALENESS) {
                emit PriceQueried(price, updatedAt);
                return price;
            }
            // Primary returned invalid/stale data, fallback
            emit StalePrice(updatedAt);
        } catch {
            // Primary call failed (e.g., contract not deployed)
            emit StalePrice(0);
        }

        // Fallback to secondary oracle
        require(address(secondaryFeed) != address(0), "No secondary oracle");

        (
            uint80 roundId2,
            int256 price2,
            ,
            uint256 updatedAt2,
            uint80 answeredInRound2
        ) = secondaryFeed.latestRoundData();

        require(price2 > 0, "Invalid price");
        require(answeredInRound2 >= roundId2, "Incomplete round");
        require(block.timestamp - updatedAt2 < MAX_STALENESS, "Both oracles stale");

        emit PriceQueried(price2, updatedAt2);
        return price2;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        require(msg.sender == owner, "Not owner");
        MAX_STALENESS = _maxStaleness;
    }
}
