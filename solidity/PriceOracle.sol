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
    AggregatorV3Interface public priceFeed;
    AggregatorV3Interface public fallbackFeed;
    uint256 public constant MAX_STALENESS = 1 hours;

    event StalePrice(address indexed feed, int256 price, uint256 updatedAt);
    event FallbackActivated(address indexed fallbackFeed);

    constructor(address _priceFeed) {
        require(_priceFeed != address(0), "Invalid price feed");
        priceFeed = AggregatorV3Interface(_priceFeed);
    }

    function setFallbackOracle(address _fallbackFeed) external onlyOwner {
        require(_fallbackFeed != address(0), "Invalid fallback feed");
        fallbackFeed = AggregatorV3Interface(_fallbackFeed);
    }

    function getLatestPrice() public returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = priceFeed.latestRoundData();

        bool isPrimaryValid = price > 0 &&
            answeredInRound >= roundId &&
            block.timestamp - updatedAt < MAX_STALENESS &&
            updatedAt != 0;

        if (isPrimaryValid) {
            return price;
        }

        emit StalePrice(address(priceFeed), price, updatedAt);

        // Try fallback if primary is stale or invalid
        require(address(fallbackFeed) != address(0), "Primary stale, no fallback");
        
        emit FallbackActivated(address(fallbackFeed));

        (
            uint80 fbRoundId,
            int256 fbPrice,
            ,
            uint256 fbUpdatedAt,
            uint80 fbAnsweredInRound
        ) = fallbackFeed.latestRoundData();

        require(
            fbPrice > 0 &&
            fbAnsweredInRound >= fbRoundId &&
            block.timestamp - fbUpdatedAt < MAX_STALENESS &&
            fbUpdatedAt != 0,
            "Fallback oracle also stale/invalid"
        );

        return fbPrice;
    }
}
