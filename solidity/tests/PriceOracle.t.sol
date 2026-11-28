// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PriceOracle} from "../contracts/PriceOracle.sol";

contract MockV3Aggregator is AggregatorV3Interface {
    uint80 public roundId = 1;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public answeredInRound = 1;
    uint8 public dec = 8;

    constructor(int256 _answer, uint256 _updatedAt) {
        answer = _answer;
        updatedAt = _updatedAt;
    }

    function setAll(uint80 _roundId, int256 _answer, uint256 _updatedAt, uint80 _answeredInRound) external {
        roundId = _roundId;
        answer = _answer;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, 0, updatedAt, answeredInRound);
    }
    function decimals() external view override returns (uint8) { return dec; }
}

contract PriceOracleTest is Test {
    event StalePrice(uint256 primaryUpdatedAt);
    event PriceQueried(int256 price, uint256 timestamp);

    PriceOracle oracle;
    MockV3Aggregator primary;
    MockV3Aggregator secondary;

    function setUp() public {
        primary = new MockV3Aggregator(2000e8, block.timestamp);
        secondary = new MockV3Aggregator(2001e8, block.timestamp);
        oracle = new PriceOracle(address(primary));
        oracle.setSecondaryFeed(address(secondary));
    }

    function test_valid_price() public {
        primary.setAll(5, 2000e8, block.timestamp, 5);
        vm.expectEmit(true, true, true, true, address(oracle));
        emit PriceQueried(2000e8, block.timestamp);
        assertEq(oracle.getLatestPrice(), 2000e8);
    }

    function test_stale_price_falls_back() public {
        primary.setAll(5, 2000e8, block.timestamp - 7200, 5); // stale
        secondary.setAll(6, 2001e8, block.timestamp, 6);      // fresh
        vm.expectEmit(true, true, true, true, address(oracle));
        emit StalePrice(block.timestamp - 7200);
        assertEq(oracle.getLatestPrice(), 2001e8);
    }

    function test_negative_price_falls_back() public {
        primary.setAll(5, -5e8, block.timestamp, 5);
        secondary.setAll(6, 2001e8, block.timestamp, 6);
        assertEq(oracle.getLatestPrice(), 2001e8);
    }

    function test_zero_price_falls_back() public {
        primary.setAll(5, 0, block.timestamp, 5);
        secondary.setAll(6, 2001e8, block.timestamp, 6);
        assertEq(oracle.getLatestPrice(), 2001e8);
    }

    function test_incomplete_round_falls_back() public {
        primary.setAll(5, 2000e8, block.timestamp, 4); // answeredInRound < roundId
        secondary.setAll(6, 2001e8, block.timestamp, 6);
        assertEq(oracle.getLatestPrice(), 2001e8);
    }

    function test_both_stale_reverts() public {
        primary.setAll(5, 2000e8, block.timestamp - 7200, 5);
        secondary.setAll(6, 2001e8, block.timestamp - 7200, 6);
        vm.expectRevert("Stale price");
        oracle.getLatestPrice();
    }

    function test_owner_can_set_staleness() public {
        oracle.setMaxStaleness(600);
        assertEq(oracle.MAX_STALENESS(), 600);
    }

    function test_non_owner_cannot_set_staleness() public {
        vm.prank(address(0xdead));
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(600);
    }

    function test_non_owner_cannot_set_secondary() public {
        vm.prank(address(0xdead));
        vm.expectRevert("Not owner");
        oracle.setSecondaryFeed(address(0x1234));
    }
}