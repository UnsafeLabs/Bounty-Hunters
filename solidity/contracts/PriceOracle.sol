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
    AggregatorV3Interface public fallbackFeed; // Fallback oracle added
    address public owner;
    uint256 public MAX_STALENESS = 3600;

    event PriceQueried(int256 price, uint256 timestamp);
    event FallbackOracleSet(address fallbackFeed);

    constructor(address _primaryFeed) {
        require(_primaryFeed != address(0), "Invalid primary feed address");
        primaryFeed = AggregatorV3Interface(_primaryFeed);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function setFallbackOracle(address _fallbackFeed) external onlyOwner {
        require(_fallbackFeed != address(0), "Invalid fallback feed address");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
        emit FallbackOracleSet(_fallbackFeed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        require(_maxStaleness > 0, "Staleness must be > 0");
        MAX_STALENESS = _maxStaleness;
    }

    function getLatestPrice() external view returns (int256) {
        // Attempt to fetch price from primary feed
        try primaryFeed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            uint256 /* startedAt */,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // Validate primary round data
            if (price > 0 && answeredInRound >= roundId && block.timestamp - updatedAt < MAX_STALENESS) {
                return price;
            }
        } catch {}

        // Fallback to secondary feed if primary fails or returns stale/invalid data
        require(address(fallbackFeed) != address(0), "Primary failed and no fallback configured");

        (
            uint80 fbRoundId,
            int256 fbPrice,
            ,
            uint256 fbUpdatedAt,
            uint80 fbAnsweredInRound
        ) = fallbackFeed.latestRoundData();

        require(fbPrice > 0, "Invalid fallback price");
        require(fbAnsweredInRound >= fbRoundId, "Incomplete fallback round");
        require(block.timestamp - fbUpdatedAt < MAX_STALENESS, "Fallback price stale");

        return fbPrice;
    }

    function getDecimals() external view returns (uint8) {
        try primaryFeed.decimals() returns (uint8 decs) {
            return decs;
        } catch {
            require(address(fallbackFeed) != address(0), "Primary decimals failed and no fallback");
            return fallbackFeed.decimals();
        }
    }
}
