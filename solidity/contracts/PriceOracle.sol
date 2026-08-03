// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AggregatorV3Interface
 * @dev Standard Chainlink interface for price feeds.
 */
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

/**
 * @title PriceOracle
 * @notice A robust price oracle with validation and fallback mechanism.
 */
contract PriceOracle {
    AggregatorV3Interface public primaryFeed;
    AggregatorV3Interface public fallbackFeed;
    address public owner;
    uint256 public MAX_STALENESS = 3600;

    event PriceQueried(int256 price, uint256 timestamp);
    event StalePrice(uint256 primaryUpdatedAt, uint256 timestamp);
    event MaxStalenessUpdated(uint256 oldStaleness, uint256 newStaleness);
    event FallbackOracleUpdated(address oldFallback, address newFallback);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    /**
     * @param _primaryFeed The address of the primary Chainlink price feed.
     * @param _fallbackFeed The address of the fallback Chainlink price feed.
     */
    constructor(address _primaryFeed, address _fallbackFeed) {
        require(_primaryFeed != address(0), "Primary feed cannot be zero address");
        require(_fallbackFeed != address(0), "Fallback feed cannot be zero address");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /**
     * @notice Fetches the latest price from the primary oracle with validation.
     * @dev Falls back to secondary oracle if primary is stale or invalid.
     * @return The validated price.
     */
    function getLatestPrice() external returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = primaryFeed.latestRoundData();

        // Validation for primary feed
        if (price <= 0 || answeredInRound < roundId || block.timestamp - updatedAt >= MAX_STALENESS) {
            emit StalePrice(updatedAt, block.timestamp);
            
            // Try fallback oracle
            (
                uint80 fRoundId,
                int256 fPrice,
                ,
                uint256 fUpdatedAt,
                uint80 fAnsweredInRound
            ) = fallbackFeed.latestRoundData();

            require(fPrice > 0, "Invalid fallback price");
            require(fAnsweredInRound >= fRoundId, "Incomplete fallback round");
            require(block.timestamp - fUpdatedAt < MAX_STALENESS, "Fallback price stale");

            emit PriceQueried(fPrice, block.timestamp);
            return fPrice;
        }

        emit PriceQueried(price, block.timestamp);
        return price;
    }

    /**
     * @notice Returns the decimals of the primary feed.
     */
    function getDecimals() external view returns (uint8) {
        return primaryFeed.decimals();
    }

    /**
     * @notice Updates the maximum allowable staleness period.
     * @param _maxStaleness The new staleness period in seconds.
     */
    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Staleness must be positive");
        emit MaxStalenessUpdated(MAX_STALENESS, _maxStaleness);
        MAX_STALENESS = _maxStaleness;
    }

    /**
     * @notice Updates the fallback oracle address.
     * @param _fallbackFeed The new fallback feed address.
     */
    function setFallbackOracle(address _fallbackFeed) external onlyOwner {
        require(_fallbackFeed != address(0), "Fallback feed cannot be zero address");
        emit FallbackOracleUpdated(address(fallbackFeed), _fallbackFeed);
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }
    
    /**
     * @notice Transfers ownership of the contract.
     * @param _newOwner The address of the new owner.
     */
    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "New owner is zero address");
        emit OwnershipTransferred(owner, _newOwner);
        owner = _newOwner;
    }
}
