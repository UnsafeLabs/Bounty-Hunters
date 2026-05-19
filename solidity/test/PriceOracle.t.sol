// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";

contract MockAggregator is AggregatorV3Interface {
    uint80 public roundId;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;
    uint8 public decimalsValue = 8;

    function setMockData(
        uint80 _roundId,
        int256 _answer,
        uint256 _updatedAt,
        uint80 _answeredInRound
    ) external {
        roundId = _roundId;
        answer = _answer;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }

    function latestRoundData() external view override returns (
        uint80,
        int256,
        uint256,
        uint256,
        uint80
    ) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function decimals() external view override returns (uint8) {
        return decimalsValue;
    }
}

contract PriceOracleTest is Test {
    PriceOracle public oracle;
    MockAggregator public primary;
    MockAggregator public fallbackOracle;

    event StalePrice(uint256 lastUpdateTimestamp);

    function setUp() public {
        primary = new MockAggregator();
        fallbackOracle = new MockAggregator();
        
        oracle = new PriceOracle(address(primary));
        oracle.setFallbackOracle(address(fallbackOracle));

        vm.warp(1000000); // Set fixed timestamp
    }

    function test_ValidPrice() public {
        primary.setMockData(1, 2000e8, block.timestamp - 100, 1);
        
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    function test_StalePriceTriggersFallback() public {
        // Primary is stale (2 hours old)
        primary.setMockData(1, 2000e8, block.timestamp - 7200, 1);
        
        // Fallback is fresh
        fallbackOracle.setMockData(1, 2100e8, block.timestamp - 100, 1);

        vm.expectEmit(true, true, true, true);
        emit StalePrice(block.timestamp - 7200);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 2100e8);
    }

    function test_NegativePriceReverts() public {
        primary.setMockData(1, -100, block.timestamp - 100, 1);
        
        // Negative price makes primary invalid, so it tries fallback
        // Fallback is uninitialized so it will return 0 which is also invalid
        vm.expectRevert("Invalid fallback price");
        oracle.getLatestPrice();
    }

    function test_IncompleteRoundReverts() public {
        // answeredInRound < roundId
        primary.setMockData(2, 2000e8, block.timestamp - 100, 1);
        
        // Make fallback valid but with incomplete round
        fallbackOracle.setMockData(2, 2000e8, block.timestamp - 100, 1);
        
        vm.expectRevert("Incomplete fallback round");
        oracle.getLatestPrice();
    }

    function test_BothOraclesStale() public {
        primary.setMockData(1, 2000e8, block.timestamp - 7200, 1);
        fallbackOracle.setMockData(1, 2100e8, block.timestamp - 7200, 1);

        vm.expectRevert("Fallback oracle also stale");
        oracle.getLatestPrice();
    }
}
