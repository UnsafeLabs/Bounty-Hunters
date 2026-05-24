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
    event StalePrice(uint256 timestamp, string message);

    constructor(address _primaryFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function setSecondaryFeed(address _secondaryFeed) external onlyOwner {
        secondaryFeed = AggregatorV3Interface(_secondaryFeed);
    }

    function getLatestPrice() external returns (int256) {
        // Try primary feed first
        try this._queryPrice(primaryFeed) returns (int256 price) {
            emit PriceQueried(price, block.timestamp);
            return price;
        } catch {
            // Primary failed — try secondary if available
            if (address(secondaryFeed) != address(0)) {
                emit StalePrice(block.timestamp, "Primary feed stale or invalid, falling back to secondary");
                try this._queryPrice(secondaryFeed) returns (int256 price) {
                    emit PriceQueried(price, block.timestamp);
                    return price;
                } catch {
                    revert("Both primary and secondary feeds failed");
                }
            }
            revert("Primary feed failed and no secondary feed configured");
        }

        // unreachable but required by compiler
        return 0;
    }

    function _queryPrice(AggregatorV3Interface feed) external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        require(price > 0, "Invalid price: must be positive");
        require(answeredInRound >= roundId, "Stale round: incomplete round");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price: data too old");

        return price;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        MAX_STALENESS = _maxStaleness;
    }
}
