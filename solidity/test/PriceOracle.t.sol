// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";

/// @dev Mock Chainlink AggregatorV3 feed with controllable return values
contract MockAggregatorV3 is AggregatorV3Interface {
    uint80 public roundId = 1;
    int256 public answer = 2000e8; // e.g. ETH = $2,000
    uint256 public startedAt = 1000;
    uint256 public updatedAt = 1000;
    uint80 public answeredInRound = 1;
    uint8 public override decimals = 8;

    function setRoundData(
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

    function latestRoundData() external view override returns (
        uint80,
        int256,
        uint256,
        uint256,
        uint80
    ) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}

contract PriceOracleTest is Test {
    PriceOracle public oracle;
    MockAggregatorV3 public primaryFeed;
    MockAggregatorV3 public fallbackFeed;

    event StalePrice(address indexed primaryOracle, uint256 updatedAt, uint256 currentTime);

    function setUp() public {
        primaryFeed = new MockAggregatorV3();
        fallbackFeed = new MockAggregatorV3();

        // Initial time
        vm.warp(2000);

        // Configure feeds with fresh data (100 seconds old, < 3600 staleness)
        primaryFeed.setRoundData(10, 3000e8, 1900, 1900, 10);
        fallbackFeed.setRoundData(10, 3005e8, 1900, 1900, 10);

        oracle = new PriceOracle(address(primaryFeed), address(fallbackFeed));
    }

    function test_freshPrimaryReturnsDirectly() public {
        int256 price = oracle.getLatestPrice();
        assertEq(price, 3000e8, "Primary fresh price should be returned");
    }

    function test_stalePrimaryFallsBackToSecondary() public {
        // Warp time so primary data is stale (> 3600s old)
        // Primary was updated at 1900. Warp to 1900 + 3601 = 5501.
        vm.warp(5501);

        // Keep fallback feed fresh at 5400
        fallbackFeed.setRoundData(11, 3010e8, 5400, 5400, 11);

        vm.expectEmit(true, false, false, true);
        emit StalePrice(address(primaryFeed), 1900, 5501);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 3010e8, "Fallback feed price should be returned when primary is stale");
    }

    function test_revertNegativePrice() public {
        primaryFeed.setRoundData(10, -100, 1900, 1900, 10);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function test_revertZeroPrice() public {
        primaryFeed.setRoundData(10, 0, 1900, 1900, 10);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function test_revertIncompleteRound() public {
        // answeredInRound < roundId indicates incomplete round
        primaryFeed.setRoundData(10, 3000e8, 1900, 1900, 9);
        vm.expectRevert("Round incomplete");
        oracle.getLatestPrice();
    }

    function test_revertWhenBothFeedsStale() public {
        // Warp time so both feeds are stale
        vm.warp(10000);
        vm.expectRevert("Stale price");
        oracle.getLatestPrice();
    }

    function test_revertWhenStaleAndNoFallback() public {
        PriceOracle noFallbackOracle = new PriceOracle(address(primaryFeed), address(0));
        vm.warp(5501); // Make primary stale
        vm.expectRevert("Stale price and no fallback configured");
        noFallbackOracle.getLatestPrice();
    }

    function test_setMaxStaleness() public {
        oracle.setMaxStaleness(1800);
        assertEq(oracle.MAX_STALENESS(), 1800);

        vm.prank(address(0xDEAD));
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(7200);
    }
}
