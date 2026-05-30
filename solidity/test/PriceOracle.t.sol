// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";

contract MockAggregator {
    int256 public price;
    uint256 public updatedAt;
    uint80 public roundId;
    uint80 public answeredInRound;

    constructor(int256 _price, uint256 _updatedAt, uint80 _roundId, uint80 _answeredInRound) {
        price = _price;
        updatedAt = _updatedAt;
        roundId = _roundId;
        answeredInRound = _answeredInRound;
    }

    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    ) {
        return (roundId, price, 0, updatedAt, answeredInRound);
    }

    function decimals() external pure returns (uint8) { return 8; }

    function setData(int256 _price, uint256 _updatedAt, uint80 _roundId, uint80 _answeredInRound) external {
        price = _price;
        updatedAt = _updatedAt;
        roundId = _roundId;
        answeredInRound = _answeredInRound;
    }
}

contract PriceOracleTest is Test {
    PriceOracle oracle;
    MockAggregator primary;
    MockAggregator fallback_;

    function setUp() public {
        primary = new MockAggregator(200000000000, block.timestamp, 1, 1);
        fallback_ = new MockAggregator(199000000000, block.timestamp, 1, 1);
        oracle = new PriceOracle(address(primary));
        oracle.setFallbackFeed(address(fallback_));
    }

    function test_ValidPrice() public {
        int256 price = oracle.getLatestPrice();
        assertEq(price, 200000000000);
    }

    function test_StalePrice_FallsBackToSecondary() public {
        primary.setData(200000000000, block.timestamp - 3601, 1, 1);
        vm.expectEmit(true, false, false, false);
        emit PriceOracle.StalePrice(block.timestamp - 3601);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 199000000000);
    }

    function test_NegativePrice_Reverts() public {
        primary.setData(-1, block.timestamp, 1, 1);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function test_ZeroPrice_Reverts() public {
        primary.setData(0, block.timestamp, 1, 1);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function test_IncompleteRound_Reverts() public {
        primary.setData(200000000000, block.timestamp, 2, 1);
        vm.expectRevert("Incomplete round");
        oracle.getLatestPrice();
    }

    function test_BothOracles_Stale_Reverts() public {
        primary.setData(200000000000, block.timestamp - 3601, 1, 1);
        fallback_.setData(199000000000, block.timestamp - 3601, 1, 1);
        vm.expectRevert("Both oracles stale");
        oracle.getLatestPrice();
    }

    function test_SetMaxStaleness_OnlyOwner() public {
        oracle.setMaxStaleness(7200);
        assertEq(oracle.MAX_STALENESS(), 7200);
    }

    function test_SetMaxStaleness_NotOwner_Reverts() public {
        vm.prank(address(0xdead));
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(7200);
    }
}
