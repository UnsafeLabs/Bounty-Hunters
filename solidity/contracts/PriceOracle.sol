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
    AggregatorV3Interface public primaryOracle;
    AggregatorV3Interface public fallbackOracle;
    uint256 public maxStaleness;
    address public owner;

    event StalePrice(uint256 primaryTimestamp, uint256 fallbackTimestamp);
    event PriceUpdated(uint256 price, uint256 timestamp);
    event MaxStalenessUpdated(uint256 oldMaxStaleness, uint256 newMaxStaleness);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(
        address _primaryOracle,
        address _fallbackOracle,
        uint256 _maxStaleness
    ) {
        require(_primaryOracle != address(0), "Invalid primary oracle");
        require(_fallbackOracle != address(0), "Invalid fallback oracle");
        require(_maxStaleness > 0, "Invalid max staleness");

        primaryOracle = AggregatorV3Interface(_primaryOracle);
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
        maxStaleness = _maxStaleness;
        owner = msg.sender;
    }

    /**
     * @notice Get the latest price from the oracle with fallback mechanism
     * @return price The latest price
     */
    function getPrice() public view returns (int256) {
        // Try primary oracle first
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryOracle.latestRoundData();

        // Validate primary oracle response
        if (isPriceValid(roundId, price, updatedAt, answeredInRound)) {
            return price;
        }

        // Primary oracle data is invalid, emit event and try fallback
        emit StalePrice(updatedAt, block.timestamp);

        // Try fallback oracle
        (
            uint80 fallbackRoundId,
            int256 fallbackPrice,
            ,
            uint256 fallbackUpdatedAt,
            uint80 fallbackAnsweredInRound
        ) = fallbackOracle.latestRoundData();

        // Validate fallback oracle response
        if (isPriceValid(fallbackRoundId, fallbackPrice, fallbackUpdatedAt, fallbackAnsweredInRound)) {
            return fallbackPrice;
        }

        // Both oracles are stale, revert
        revert("Both oracles return stale data");
    }

    /**
     * @notice Check if price data is valid
     * @param roundId The round ID from the oracle
     * @param price The price from the oracle
     * @param updatedAt The timestamp when the price was updated
     * @param answeredInRound The round ID when the price was answered
     * @return valid True if the price data is valid
     */
    function isPriceValid(
        uint80 roundId,
        int256 price,
        uint256 updatedAt,
        uint80 answeredInRound
    ) internal view returns (bool valid) {
        // Check round completeness
        if (answeredInRound < roundId) {
            return false;
        }

        // Check price is positive
        if (price <= 0) {
            return false;
        }

        // Check staleness
        if (block.timestamp - updatedAt >= maxStaleness) {
            return false;
        }

        return true;
    }

    /**
     * @notice Update the maximum staleness threshold
     * @param _maxStaleness The new maximum staleness in seconds
     */
    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Invalid max staleness");
        
        emit MaxStalenessUpdated(maxStaleness, _maxStaleness);
        maxStaleness = _maxStaleness;
    }

    /**
     * @notice Update the fallback oracle address
     * @param _fallbackOracle The new fallback oracle address
     */
    function setFallbackOracle(address _fallbackOracle) external onlyOwner {
        require(_fallbackOracle != address(0), "Invalid fallback oracle");
        fallbackOracle = AggregatorV3Interface(_fallbackOracle);
    }

    /**
     * @notice Update the primary oracle address
     * @param _primaryOracle The new primary oracle address
     */
    function setPrimaryOracle(address _primaryOracle) external onlyOwner {
        require(_primaryOracle != address(0), "Invalid primary oracle");
        primaryOracle = AggregatorV3Interface(_primaryOracle);
    }
}
}
