// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";
import "./MockAggregatorV3.sol";

contract PriceOracleTest is Test {
    PriceOracle public oracle;
    MockAggregatorV3 public primaryMock;
    MockAggregatorV3 public fallbackMock;

    address public owner = address(0x1);
    uint256 public constant STALENESS_THRESHOLD = 3600;

    function setUp() public {
        // Deploy mocks with valid initial data
        primaryMock = new MockAggregatorV3(100000000, block.timestamp - 100, 8);
        fallbackMock = new MockAggregatorV3(100000000, block.timestamp - 100, 8);

        // Deploy oracle
        oracle = new PriceOracle(address(primaryMock), address(fallbackMock));
    }

    // ========== Test: Valid Price ==========
    function test_ValidPrice_ReturnsPrimaryPrice() public view {
        int256 price = oracle.getLatestPrice();
        assertEq(price, 100000000, "Should return primary price");
    }

    function test_ValidPrice_EmitsPriceQueried() public {
        vm.expectEmit(true, true, true, true);
        emit PriceOracle.PriceQueried(100000000, block.timestamp - 100);
        oracle.getLatestPrice();
    }

    // ========== Test: Stale Price ==========
    function test_StalePrice_FallsBackToSecondary() public {
        // Make primary stale
        primaryMock.setUpdatedAt(block.timestamp - 7200); // 2 hours ago

        int256 price = oracle.getLatestPrice();
        assertEq(price, 100000000, "Should return fallback price");
    }

    function test_StalePrice_EmitsStalePriceEvent() public {
        primaryMock.setUpdatedAt(block.timestamp - 7200);

        vm.expectEmit(true, true, true, true);
        emit PriceOracle.StalePrice(block.timestamp - 7200, block.timestamp - 100);
        oracle.getLatestPrice();
    }

    // ========== Test: Negative/Zero Price ==========
    function test_NegativePrice_FallsBackToSecondary() public {
        primaryMock.setAnswer(-100000000);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 100000000, "Should return fallback price");
    }

    function test_ZeroPrice_FallsBackToSecondary() public {
        primaryMock.setAnswer(0);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 100000000, "Should return fallback price");
    }

    // ========== Test: Incomplete Round ==========
    function test_IncompleteRound_FallsBackToSecondary() public {
        // Set incomplete round (answeredInRound < roundId)
        primaryMock.setRoundData(2, 100000000, block.timestamp - 100, 1);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 100000000, "Should return fallback price");
    }

    // ========== Test: Both Oracles Stale ==========
    function test_BothOraclesStale_Reverts() public {
        primaryMock.setUpdatedAt(block.timestamp - 7200);
        fallbackMock.setUpdatedAt(block.timestamp - 7200);

        vm.expectRevert("Both oracles are stale");
        oracle.getLatestPrice();
    }

    // ========== Test: Both Oracles Incomplete ==========
    function test_BothOraclesIncomplete_Reverts() public {
        primaryMock.setRoundData(2, 100000000, block.timestamp - 100, 1);
        fallbackMock.setRoundData(2, 100000000, block.timestamp - 100, 1);

        vm.expectRevert("Both oracles have incomplete rounds");
        oracle.getLatestPrice();
    }

    // ========== Test: Both Oracles Invalid Price ==========
    function test_BothOraclesInvalidPrice_Reverts() public {
        primaryMock.setAnswer(-100000000);
        fallbackMock.setAnswer(-100000000);

        vm.expectRevert("Both oracles have invalid prices");
        oracle.getLatestPrice();
    }

    // ========== Test: Configurable MAX_STALENESS ==========
    function test_SetMaxStaleness_OnlyOwner() public {
        vm.prank(address(0x2)); // Non-owner
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(100);
    }

    function test_SetMaxStaleness_Owner() public {
        vm.prank(owner);
        oracle.setMaxStaleness(100);
        assertEq(oracle.MAX_STALENESS(), 100, "Should update MAX_STALENESS");
    }

    // ========== Test: Set Fallback Feed ==========
    function test_SetFallbackFeed_OnlyOwner() public {
        vm.prank(address(0x2));
        vm.expectRevert("Not owner");
        oracle.setFallbackFeed(address(0x3));
    }

    function test_SetFallbackFeed_EmitsEvent() public {
        MockAggregatorV3 newMock = new MockAggregatorV3(200000000, block.timestamp - 100, 8);
        
        vm.expectEmit(true, true, true, true);
        emit PriceOracle.FallbackFeedUpdated(address(fallbackMock), address(newMock));
        oracle.setFallbackFeed(address(newMock));
    }

    // ========== Test: Fallback Returns Different Price ==========
    function test_FallbackReturnsDifferentPrice() public {
        // Make primary stale
        primaryMock.setUpdatedAt(block.timestamp - 7200);
        // Set different price on fallback
        fallbackMock.setAnswer(200000000);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 200000000, "Should return fallback's different price");
    }

    // ========== Test: Edge Cases ==========
    function test_BoundaryStaleness_ExactlyAtThreshold() public {
        // Set updatedAt exactly at threshold (should NOT be stale)
        primaryMock.setUpdatedAt(block.timestamp - STALENESS_THRESHOLD);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 100000000, "Should still use primary at exact threshold");
    }

    function test_BoundaryStaleness_OneSecondOver() public {
        // Set updatedAt one second over threshold (should be stale)
        primaryMock.setUpdatedAt(block.timestamp - STALENESS_THRESHOLD - 1);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 100000000, "Should use fallback one second over threshold");
    }
}
