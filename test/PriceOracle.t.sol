// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/PriceOracle.sol";

contract MockAggregator is AggregatorV3Interface {
    int256 public price;
    uint8 public decimals;
    uint80 public roundId;
    uint80 public answeredInRound;
    uint256 public updatedAt;

    constructor(int256 _price, uint8 _decimals) {
        price = _price;
        decimals = _decimals;
        roundId = 1;
        answeredInRound = 1;
        updatedAt = block.timestamp;
    }

    function setPrice(int256 _price) external {
        price = _price;
    }

    function setRoundData(uint80 _roundId, int256 _price, uint256 _updatedAt, uint80 _answeredInRound) external {
        roundId = _roundId;
        price = _price;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }

    function latestRoundData() external view returns (
        uint80 roundId_,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt_,
        uint80 answeredInRound_
    ) {
        return (roundId, price, updatedAt, updatedAt, answeredInRound);
    }

    function decimals() external view returns (uint8) {
        return decimals;
    }
}

contract PriceOracleTest is Test {
    PriceOracle public oracle;
    MockAggregator public primaryFeed;
    MockAggregator public fallbackFeed;

    address public owner = vm.addr(1);
    address public nonOwner = vm.addr(2);

    function setUp() public {
        primaryFeed = new MockAggregator(1000, 8);
        fallbackFeed = new MockAggregator(999, 8);

        vm.prank(owner);
        oracle = new PriceOracle(address(primaryFeed), address(fallbackFeed));
    }

    function test_GetLatestPrice() public {
        int256 price = oracle.getLatestPrice();
        assertEq(price, 1000);
    }

    function test_GetLatestPrice_ZeroPrice_Reverts() public {
        primaryFeed.setPrice(0);
        vm.expectRevert("Invalid price: zero or negative");
        oracle.getLatestPrice();
    }

    function test_GetLatestPrice_NegativePrice_Reverts() public {
        primaryFeed.setPrice(-100);
        vm.expectRevert("Invalid price: zero or negative");
        oracle.getLatestPrice();
    }

    function test_GetLatestPrice_StaleData_Reverts() public {
        primaryFeed.setRoundData(1, 1000, block.timestamp - 3601, 1);
        vm.expectRevert("Price data stale");
        oracle.getLatestPrice();
    }

    function test_GetLatestPrice_IncompleteRound_Reverts() public {
        primaryFeed.setRoundData(2, 1000, block.timestamp, 1);
        vm.expectRevert("Round incomplete");
        oracle.getLatestPrice();
    }

    function test_GetPriceWithFallback() public {
        int256 price = oracle.getPriceWithFallback();
        assertEq(price, 1000);
    }

    function test_GetPriceWithFallback_UsesFallback() public {
        // Make primary feed fail
        primaryFeed.setPrice(0);

        int256 price = oracle.getPriceWithFallback();
        assertEq(price, 999);
    }

    function test_GetDecimals() public {
        uint8 decimals = oracle.getDecimals();
        assertEq(decimals, 8);
    }

    function test_SetMaxStaleness() public {
        vm.prank(owner);
        oracle.setMaxStaleness(7200);
        assertEq(oracle.maxStaleness(), 7200);
    }

    function test_SetMaxStaleness_NonOwner_Reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(7200);
    }

    function test_SetMaxStaleness_InvalidStaleness_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("Invalid staleness");
        oracle.setMaxStaleness(0);
    }

    function test_SetFallbackFeed() public {
        MockAggregator newFallback = new MockAggregator(998, 8);
        vm.prank(owner);
        oracle.setFallbackFeed(address(newFallback));
        assertEq(address(oracle.fallbackFeed()), address(newFallback));
    }

    function test_SetFallbackFeed_NonOwner_Reverts() public {
        MockAggregator newFallback = new MockAggregator(998, 8);
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        oracle.setFallbackFeed(address(newFallback));
    }

    function test_SetFallbackFeed_InvalidAddress_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("Invalid fallback feed");
        oracle.setFallbackFeed(address(0));
    }

    function test_Constructor_InvalidPrimaryFeed_Reverts() public {
        vm.expectRevert("Invalid primary feed");
        new PriceOracle(address(0), address(fallbackFeed));
    }
}
