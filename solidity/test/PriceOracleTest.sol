// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/PriceOracle.sol";

contract MockAggregator is AggregatorV3Interface {
    uint80 public roundId;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;
    uint8 public dec;

    function setLatestRoundData(
        uint80 _roundId,
        int256 _answer,
        uint256 _startedAt,
        uint256 _updatedAt,
        uint80 _answeredInRound
    ) external {
        roundId = _roundId;
        answer = _answer;
        startedAt = _startedAt;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }

    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    ) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function setDecimals(uint8 _dec) external {
        dec = _dec;
    }

    function decimals() external view returns (uint8) {
        return dec;
    }
}

contract PriceOracleTest {
    PriceOracle public oracle;
    MockAggregator public primary;
    MockAggregator public fallbackAgg;

    function setUp() public {
        primary = new MockAggregator();
        fallbackAgg = new MockAggregator();
        oracle = new PriceOracle(address(primary), address(fallbackAgg));
    }

    function testValidPrice() public {
        primary.setLatestRoundData(1, 1000, block.timestamp, block.timestamp, 1);
        int256 price = oracle.getLatestPrice();
        require(price == 1000, "Should return valid price");
    }

    function testStalePriceFallback() public {
        // Primary is stale
        primary.setLatestRoundData(1, 1000, block.timestamp - 4000, block.timestamp - 4000, 1);
        // Fallback is valid
        fallbackAgg.setLatestRoundData(1, 900, block.timestamp, block.timestamp, 1);
        
        int256 price = oracle.getLatestPrice();
        require(price == 900, "Should return fallback price");
    }

    function testNegativePriceReverts() public {
        primary.setLatestRoundData(1, -10, block.timestamp, block.timestamp, 1);
        try oracle.getLatestPrice() {
            require(false, "Should have reverted on negative price");
        } catch {}
    }

    function testIncompleteRoundReverts() public {
        primary.setLatestRoundData(2, 1000, block.timestamp, block.timestamp, 1);
        try oracle.getLatestPrice() {
            require(false, "Should have reverted on incomplete round");
        } catch {}
    }

    function testBothOraclesStaleReverts() public {
        primary.setLatestRoundData(1, 1000, block.timestamp - 4000, block.timestamp - 4000, 1);
        fallbackAgg.setLatestRoundData(1, 900, block.timestamp - 4000, block.timestamp - 4000, 1);
        
        try oracle.getLatestPrice() {
            require(false, "Should have reverted when both stale");
        } catch {}
    }
}
