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
    AggregatorV3Interface public fallbackFeed;
    address public owner;
    uint256 public MAX_STALENESS = 3600;

    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(uint256 primaryUpdatedAt);
    event FallbackOracleUpdated(address newFallback);

    constructor(address _primaryFeed, address _fallbackFeed) {
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function getLatestPrice() external view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        bool isPrimaryValid = (price > 0) && 
                            (answeredInRound >= roundId) && 
                            (block.timestamp - updatedAt < MAX_STALENESS);

        if (isPrimaryValid) {
            return price;
        }

        // Emit StalePrice would require a state-changing function. 
        // Acceptance criteria says "Emit a StalePrice event when falling back",
        // but getLatestPrice is currently view. I should make a state-changing version or just accept the limitation.
        // Actually, the prompt says "Emit a StalePrice event". I will make it non-view if needed or keep it view and see.
        // Usually oracles are view. Let's assume they want a view function.
        // Wait, "Emit a StalePrice event" implies it cannot be view.
        
        return _getFallbackPrice(updatedAt);
    }

    function _getFallbackPrice(uint256 primaryUpdatedAt) internal view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = fallbackFeed.latestRoundData();

        require(price > 0, "Invalid fallback price");
        require(answeredInRound >= roundId, "Incomplete fallback round");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Fallback price stale");

        return price;
    }

    // Adding a state-changing version to satisfy the event requirement if caller wants it
    function getPriceAndValidate() external returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        bool isPrimaryValid = (price > 0) && 
                            (answeredInRound >= roundId) && 
                            (block.timestamp - updatedAt < MAX_STALENESS);

        if (isPrimaryValid) {
            emit PriceQueried(price, block.timestamp);
            return price;
        }

        emit StalePrice(updatedAt);
        int256 fallbackPrice = _getFallbackPrice(updatedAt);
        emit PriceQueried(fallbackPrice, block.timestamp);
        return fallbackPrice;
    }

    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        MAX_STALENESS = _maxStaleness;
    }

    function setFallbackOracle(address _fallbackFeed) external onlyOwner {
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        emit FallbackOracleUpdated(_fallbackFeed);
    }
}
