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

contract PriceOracle {
    AggregatorV3Interface public priceFeed;
    AggregatorV3Interface public fallbackPriceFeed;
    address public owner;
    uint256 public MAX_STALENESS = 3600; // 1 hour

    event StalePrice(uint256 lastUpdateTimestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _.priceFeed, address _fallbackPriceFeed) {
        priceFeed = AggregatorV3Interface(_priceFeed);
        fallbackPriceFeed = AggregatorV3Interface(_fallbackPriceFeed);
        owner = msg.sender;
    }

    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        MAX_STALENESS = _maxStaleness;
    }

    function setPrimaryOracle(address _priceFeed) external onlyOwner {
        priceFeed = AggregatorV3Interface(_priceFeed);
    }

    function setFallbackOracle(address _fallbackPriceFeed) external onlyOwner {
        fallbackPriceFeed = AggregatorV3Interface(_fallbackPriceFeed);
    }

    function _validatePrice(
        uint80 roundId,
        int256 price,
        uint80 answeredInRound,
        uint256 updatedAt
    ) internal view {
        require(answeredInRound >= roundId, "Incomplete round");
        require(price > 0, "Invalid price");
        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");
    }

    function getLatestPrice() public view returns (int256) {
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = priceFeed.latestRoundData();

        try this._validatePriceExternal(roundId, price, answeredInRound, updatedAt) {
            return price;
        } catch {
            // Primary oracle failed validation, try fallback
            (
                uint80 fallbackRoundId,
                int256 fallbackPrice,
                ,
                uint256 fallbackUpdatedAt,
                uint80 fallbackAnsweredInRound
            ) = fallbackPriceFeed.latestRoundData();

            // Validate fallback price
            require(fallbackAnsweredInRound >= fallbackRoundId, "Incomplete round");
            require(fallbackPrice > 0, "Invalid price");
            require(block.timestamp - fallbackUpdatedAt < MAX_STALENESS, "Stale price");

            emit StalePrice(updatedAt);

            return fallbackPrice;
        }
    }

    function _validatePriceExternal(
        uint80 roundId,
        int256 price,
        uint80 answeredInRound,
        uint256 updatedAt
    ) external view {
        require(msg.sender == address(this), "Internal use only");
        _validatePrice(roundId, price, answeredInRound, updatedAt);
    }
}
}
