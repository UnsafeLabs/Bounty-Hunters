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
        primaryMock = new MockAggregatorV3(100000000, block.timestamp - 100, 8);
        fallbackMock = new MockAggregatorV3(100000000, block.timestamp - 100, 8);
        oracle = new PriceOracle(address(primaryMock), address(fallbackMock));
    }

    // ========== Valid Price ==========
    function test_ValidPrice_ReturnsPrimaryPrice() public view {
        int256 price = oracle.getLatestPrice();
        assertEq(price, 100000000);
    }

    function test_ValidPrice_EmitsPriceQueried() public {
        vm.expectEmit(true, true, true, true);
        emit PriceOracle.PriceQueried(100000000, block.timestamp - 100);
        oracle.getLatestPrice();
    }

    // ========== Stale Price -> Fallback ==========
    function test_StalePrice_FallsBackToSecondary() public {
        primaryMock.setUpdatedAt(block.timestamp - 7200);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 100000000);
    }

    function test_StalePrice_EmitsStalePriceEvent() public {
        primaryMock.setUpdatedAt(block.timestamp - 7200);
        vm.expectEmit(true, true, true, true);
        emit PriceOracle.StalePrice(block.timestamp - 7200, block.timestamp - 100);
        oracle.getLatestPrice();
    }

    function test_StalePrice_FallbackReturnsDifferentPrice() public {
        primaryMock.setUpdatedAt(block.timestamp - 7200);
        fallbackMock.setAnswer(200000000);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 200000000);
    }

    // ========== Negative/Zero Price -> REVERT ==========
    function test_NegativePrice_Reverts() public {
        primaryMock.setAnswer(-100000000);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function test_ZeroPrice_Reverts() public {
        primaryMock.setAnswer(0);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    // ========== Incomplete Round -> REVERT ==========
    function test_IncompleteRound_Reverts() public {
        primaryMock.setRoundData(2, 100000000, block.timestamp - 100, 1);
        vm.expectRevert("Incomplete round data");
        oracle.getLatestPrice();
    }

    // ========== Both Oracles Stale -> REVERT ==========
    function test_BothOraclesStale_Reverts() public {
        primaryMock.setUpdatedAt(block.timestamp - 7200);
        fallbackMock.setUpdatedAt(block.timestamp - 7200);
        vm.expectRevert("Both oracles are stale");
        oracle.getLatestPrice();
    }

    // ========== Fallback Issues -> REVERT ==========
    function test_FallbackIncompleteRound_Reverts() public {
        primaryMock.setUpdatedAt(block.timestamp - 7200);
        fallbackMock.setRoundData(2, 100000000, block.timestamp - 100, 1);
        vm.expectRevert("Fallback oracle has incomplete round");
        oracle.getLatestPrice();
    }

    function test_FallbackInvalidPrice_Reverts() public {
        primaryMock.setUpdatedAt(block.timestamp - 7200);
        fallbackMock.setAnswer(-100000000);
        vm.expectRevert("Fallback oracle has invalid price");
        oracle.getLatestPrice();
    }

    // ========== Configurable MAX_STALENESS ==========
    function test_SetMaxStaleness_OnlyOwner() public {
        vm.prank(address(0x2));
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(100);
    }

    function test_SetMaxStaleness_Owner() public {
        vm.prank(owner);
        oracle.setMaxStaleness(100);
        assertEq(oracle.MAX_STALENESS(), 100);
    }

    // ========== Set Fallback Feed ==========
    function test_SetFallbackFeed_OnlyOwner() public {
        vm.prank(address(0x2));
        vm.expectRevert("Not owner");
        oracle.setFallbackFeed(address(0x3));
    }

    // ========== Edge Cases ==========
    function test_BoundaryStaleness_ExactlyAtThreshold() public {
        primaryMock.setUpdatedAt(block.timestamp - STALENESS_THRESHOLD);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 100000000);
    }

    function test_BoundaryStaleness_OneSecondOver() public {
        primaryMock.setUpdatedAt(block.timestamp - STALENESS_THRESHOLD - 1);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 100000000);
    }
}
