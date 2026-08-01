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

    event StalePrice(uint256 primaryUpdatedAt, uint256 timestamp);

    event MaxStalenessUpdated(uint256 oldStaleness, uint256 newStaleness);

    event FallbackOracleUpdated(address oldFallback, address newFallback);



    constructor(address _primaryFeed, address _fallbackFeed) {

        primaryFeed = AggregatorV3Interface(_primaryFeed);

        fallbackFeed = AggregatorV3Interface(_fallbackFeed);

        owner = msg.sender;

    }



    modifier onlyOwner() {

        require(msg.sender == owner, "Not owner");

        _;

    }



    /**

     * @notice Fetches the latest price from the primary oracle with validation.

     * @dev Falls back to secondary oracle if primary is stale.

     * @return The validated price.

     */

    function getLatestPrice() external view returns (int256) {

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



            return fPrice;

        }



        return price;

    }



    function getDecimals() external view returns (uint8) {

        return primaryFeed.decimals();

    }



    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {

        emit MaxStalenessUpdated(MAX_STALENESS, _maxStaleness);

        MAX_STALENESS = _maxStaleness;

    }



    function setFallbackOracle(address _fallbackFeed) external onlyOwner {

        emit FallbackOracleUpdated(address(fallbackFeed), _fallbackFeed);

        fallbackFeed = AggregatorV3Interface(_fallbackFeed);

    }



    function transferOwnership(address _newOwner) external onlyOwner {

        require(_newOwner != address(0), "New owner is zero address");

        owner = _newOwner;

    }

}

