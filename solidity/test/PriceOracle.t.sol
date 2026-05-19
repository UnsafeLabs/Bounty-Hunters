// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";

/// @notice Mock Chainlink aggregator for testing.
contract MockAggregator {
    uint80 public roundId = 1;
    int256 public answer = 2000e8;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound = 1;
    uint8 public _decimals = 8;

    function setRoundData(
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

    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    ) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }
}

contract PriceOracleTest is Test {
    PriceOracle public oracle;
    MockAggregator public primaryFeed;
    MockAggregator public fallbackFeed;

    function setUp() public {
        primaryFeed = new MockAggregator();
        fallbackFeed = new MockAggregator();
        oracle = new PriceOracle(address(primaryFeed), address(fallbackFeed));

        // Set current timestamp for staleness checks
        vm.warp(1_700_000_000);
    }

    /// @notice Valid price from primary oracle.
    function test_ValidPrice() public {
        primaryFeed.setRoundData(1, 2000e8, block.timestamp, 1);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    /// @notice Negative price reverts.
    function test_Revert_NegativePrice() public {
        primaryFeed.setRoundData(1, -100e8, block.timestamp, 1);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    /// @notice Zero price reverts.
    function test_Revert_ZeroPrice() public {
        primaryFeed.setRoundData(1, 0, block.timestamp, 1);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    /// @notice Incomplete round reverts.
    function test_Revert_IncompleteRound() public {
        // answeredInRound < roundId
        primaryFeed.setRoundData(5, 2000e8, block.timestamp, 3);
        vm.expectRevert("Incomplete round");
        oracle.getLatestPrice();
    }

    /// @notice Stale primary oracle falls back to secondary.
    function test_FallbackOnStalePrimary() public {
        // Primary: updated 2 hours ago (stale)
        primaryFeed.setRoundData(1, 2000e8, block.timestamp - 7200, 1);
        // Fallback: fresh data
        fallbackFeed.setRoundData(1, 2100e8, block.timestamp, 1);

        vm.expectEmit(true, true, false, true);
        emit StalePrice(address(primaryFeed), block.timestamp - 7200, 7200);
        vm.expectEmit(true, true, false, false);
        emit FallbackUsed(address(primaryFeed), address(fallbackFeed));

        int256 price = oracle.getLatestPrice();
        assertEq(price, 2100e8);
    }

    /// @notice Both oracles stale reverts.
    function test_Revert_BothOraclesStale() public {
        primaryFeed.setRoundData(1, 2000e8, block.timestamp - 7200, 1);
        fallbackFeed.setRoundData(1, 2100e8, block.timestamp - 7200, 1);

        vm.expectRevert("Both oracles return stale data");
        oracle.getLatestPrice();
    }

    /// @notice Primary valid, fallback stale: uses primary.
    function test_PrimaryValidFallbackStale() public {
        primaryFeed.setRoundData(1, 2000e8, block.timestamp, 1);
        fallbackFeed.setRoundData(1, 2100e8, block.timestamp - 7200, 1);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    /// @notice Owner can update MAX_STALENESS.
    function test_SetMaxStaleness() public {
        oracle.setMaxStaleness(1800);
        assertEq(oracle.MAX_STALENESS(), 1800);
    }

    /// @notice Non-owner cannot update MAX_STALENESS.
    function test_Revert_SetMaxStaleness_NotOwner() public {
        vm.prank(address(0xdead));
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(1800);
    }

    /// @notice Primary oracle with exactly MAX_STALENESS minus 1 second is valid.
    function test_Edge_JustBeforeStaleness() public {
        primaryFeed.setRoundData(1, 2000e8, block.timestamp - 3599, 1);
        fallbackFeed.setRoundData(1, 0, block.timestamp, 1); // invalid fallback
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    /// @notice Primary oracle at exactly MAX_STALENESS is stale.
    function test_Edge_ExactlyAtStaleness() public {
        primaryFeed.setRoundData(1, 2000e8, block.timestamp - 3600, 1);
        fallbackFeed.setRoundData(1, 2100e8, block.timestamp, 1);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2100e8); // falls back
    }
}
