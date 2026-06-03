// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";

// Mock Chainlink aggregator for testing
contract MockAggregator is AggregatorV3Interface {
    uint80 public overrideRoundId = 1;
    int256 public overrideAnswer = 2000 * 10 ** 8; // $2000 with 8 decimals
    uint256 public overrideStartedAt = 1000;
    uint256 public overrideUpdatedAt = 1000;
    uint80 public overrideAnsweredInRound = 1;
    uint8 public overrideDecimals = 8;

    function latestRoundData() external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (overrideRoundId, overrideAnswer, overrideStartedAt, overrideUpdatedAt, overrideAnsweredInRound);
    }

    function decimals() external view override returns (uint8) {
        return overrideDecimals;
    }

    // Test helpers
    function setPrice(int256 _price) external {
        overrideAnswer = _price;
    }

    function setUpdatedAt(uint256 _updatedAt) external {
        overrideUpdatedAt = _updatedAt;
    }

    function setRoundId(uint80 _roundId) external {
        overrideRoundId = _roundId;
    }

    function setAnsweredInRound(uint80 _answeredInRound) external {
        overrideAnsweredInRound = _answeredInRound;
    }
}

contract PriceOracleTest is Test {
    PriceOracle public oracle;
    MockAggregator public primaryFeed;
    MockAggregator public fallbackFeed;
    address public owner;

    function setUp() public {
        primaryFeed = new MockAggregator();
        fallbackFeed = new MockAggregator();
        oracle = new PriceOracle(address(primaryFeed));
        owner = address(this);
    }

    // Test: Valid price is returned correctly
    function test_ValidPriceReturned() public {
        vm.warp(1000 + 500); // 500 seconds after update, within 3600
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000 * 10 ** 8);
    }

    // Test: Stale price triggers fallback to secondary oracle
    function test_StalePriceTriggersFallback() public {
        oracle.setFallbackFeed(address(fallbackFeed));

        // Make primary stale (updated more than 3600s ago)
        primaryFeed.setUpdatedAt(1); // Very old
        fallbackFeed.setUpdatedAt(block.timestamp - 100); // Recent

        vm.warp(5000);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000 * 10 ** 8); // Fallback price
    }

    // Test: Zero or negative prices revert with clear error
    function test_ZeroPriceReverts() public {
        primaryFeed.setPrice(0);
        vm.warp(1500);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function test_NegativePriceReverts() public {
        primaryFeed.setPrice(-100);
        vm.warp(1500);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    // Test: Incomplete rounds are rejected
    function test_IncompleteRoundReverts() public {
        primaryFeed.setRoundId(5);
        primaryFeed.setAnsweredInRound(3); // answeredInRound < roundId
        vm.warp(1500);
        vm.expectRevert("Incomplete round");
        oracle.getLatestPrice();
    }

    // Test: Both oracles stale reverts instead of returning bad data
    function test_BothOraclesStaleReverts() public {
        oracle.setFallbackFeed(address(fallbackFeed));

        // Both feeds are stale
        primaryFeed.setUpdatedAt(1);
        fallbackFeed.setUpdatedAt(1);

        vm.warp(5000);
        vm.expectRevert("Both oracles stale");
        oracle.getLatestPrice();
    }

    // Test: MAX_STALENESS is configurable by owner
    function test_MaxStalenessConfigurable() public {
        oracle.setMaxStaleness(7200);
        assertEq(oracle.MAX_STALENESS(), 7200);
    }

    // Test: Non-owner cannot set MAX_STALENESS
    function test_NonOwnerCannotSetMaxStaleness() public {
        vm.prank(address(0x1));
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(7200);
    }

    // Test: Non-owner cannot set fallback feed
    function test_NonOwnerCannotSetFallbackFeed() public {
        vm.prank(address(0x1));
        vm.expectRevert("Not owner");
        oracle.setFallbackFeed(address(fallbackFeed));
    }

    // Test: No fallback available with stale primary reverts
    function test_NoFallbackStalePrimaryReverts() public {
        // No fallback set (default)
        primaryFeed.setUpdatedAt(1);
        vm.warp(5000);
        vm.expectRevert("Stale price");
        oracle.getLatestPrice();
    }

    // Test: Get decimals
    function test_GetDecimals() public {
        uint8 dec = oracle.getDecimals();
        assertEq(dec, 8);
    }
}
