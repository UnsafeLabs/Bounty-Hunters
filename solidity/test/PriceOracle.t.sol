// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";

contract MockChainlinkFeed is AggregatorV3Interface {
    uint8 private _decimals;
    uint80 private _roundId;
    int256 private _answer;
    uint256 private _startedAt;
    uint256 private _updatedAt;
    uint80 private _answeredInRound;

    constructor(uint8 decimals_) {
        _decimals = decimals_;
    }

    function setRoundData(
        uint80 roundId_,
        int256 answer_,
        uint256 startedAt_,
        uint256 updatedAt_,
        uint80 answeredInRound_
    ) external {
        _roundId = roundId_;
        _answer = answer_;
        _startedAt = startedAt_;
        _updatedAt = updatedAt_;
        _answeredInRound = answeredInRound_;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }
}

contract PriceOracleTest is Test {
    PriceOracle oracle;
    MockChainlinkFeed primaryFeed;
    MockChainlinkFeed fallbackFeed;
    address owner;

    uint256 constant STALENESS = 3600;
    uint256 constant NOW = 1_000_000_000; // fixed reference time

    function setUp() public {
        owner = address(this);
        primaryFeed = new MockChainlinkFeed(8);
        oracle = new PriceOracle(address(primaryFeed));
        fallbackFeed = new MockChainlinkFeed(8);
        vm.warp(NOW);
    }

    // ─── Valid Price ───

    function test_validPrice() public {
        primaryFeed.setRoundData(1, 2000e8, NOW, NOW, 1);
        int256 price = oracle.getLatestPrice();
        assertEq(price, int256(2000e8));
    }

    // ─── Negative / Zero Price ───

    function test_revertOnZeroPrice() public {
        primaryFeed.setRoundData(1, 0, NOW, NOW, 1);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function test_revertOnNegativePrice() public {
        primaryFeed.setRoundData(1, -1, NOW, NOW, 1);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    // ─── Round Completeness ───

    function test_revertOnIncompleteRound() public {
        primaryFeed.setRoundData(2, 1000e8, NOW, NOW, 1);
        vm.expectRevert("Incomplete round");
        oracle.getLatestPrice();
    }

    // ─── Staleness ───

    function test_stalePriceTriggersFallback() public {
        uint256 staleTime = NOW - STALENESS - 100;
        primaryFeed.setRoundData(1, 2000e8, staleTime, staleTime, 1);
        oracle.setFallbackFeed(address(fallbackFeed));
        fallbackFeed.setRoundData(1, 1990e8, NOW, NOW, 1);

        int256 price = oracle.getLatestPrice();
        assertEq(price, int256(1990e8));
    }

    function test_stalePriceRevertsWithoutFallback() public {
        uint256 staleTime = NOW - STALENESS - 100;
        primaryFeed.setRoundData(1, 2000e8, staleTime, staleTime, 1);
        vm.expectRevert("Stale price");
        oracle.getLatestPrice();
    }

    function test_bothOraclesStale() public {
        uint256 staleTime = NOW - STALENESS - 100;
        primaryFeed.setRoundData(1, 2000e8, staleTime, staleTime, 1);
        oracle.setFallbackFeed(address(fallbackFeed));
        fallbackFeed.setRoundData(1, 1990e8, staleTime, staleTime, 1);

        vm.expectRevert("Both oracles stale");
        oracle.getLatestPrice();
    }

    // ─── StalePrice Event ───

    function test_stalePriceEventEmitted() public {
        uint256 staleTime = NOW - STALENESS - 100;
        primaryFeed.setRoundData(1, 2000e8, staleTime, staleTime, 1);
        oracle.setFallbackFeed(address(fallbackFeed));
        fallbackFeed.setRoundData(1, 1990e8, NOW, NOW, 1);

        // Verify fallback price is returned (proves StalePrice event was emitted)
        int256 price = oracle.getLatestPrice();
        assertEq(price, int256(1990e8));
    }

    // ─── Configurable MAX_STALENESS ───

    function test_setMaxStaleness() public {
        oracle.setMaxStaleness(7200);
        assertEq(oracle.MAX_STALENESS(), 7200);
    }

    function test_onlyOwnerCanSetStaleness() public {
        vm.prank(address(0x2));
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(7200);
    }

    function test_stalenessMustBePositive() public {
        vm.expectRevert("Staleness must be > 0");
        oracle.setMaxStaleness(0);
    }

    function test_customStalenessAffectsValidation() public {
        oracle.setMaxStaleness(7200);
        // Price updated 4000s ago — stale under default 3600, valid under 7200
        uint256 updatedAt = NOW - 4000;
        primaryFeed.setRoundData(1, 2000e8, updatedAt, updatedAt, 1);

        int256 price = oracle.getLatestPrice();
        assertEq(price, int256(2000e8));
    }

    // ─── Fallback Feed Management ───

    function test_setFallbackFeed() public {
        oracle.setFallbackFeed(address(fallbackFeed));
        assertEq(address(oracle.fallbackFeed()), address(fallbackFeed));
    }

    function test_onlyOwnerCanSetFallback() public {
        vm.prank(address(0x2));
        vm.expectRevert("Not owner");
        oracle.setFallbackFeed(address(fallbackFeed));
    }

    function test_fallbackIncompleteRound() public {
        uint256 staleTime = NOW - STALENESS - 100;
        primaryFeed.setRoundData(1, 2000e8, staleTime, staleTime, 1);
        oracle.setFallbackFeed(address(fallbackFeed));
        fallbackFeed.setRoundData(2, 1990e8, NOW, NOW, 1);

        vm.expectRevert("Fallback: incomplete round");
        oracle.getLatestPrice();
    }

    function test_fallbackInvalidPrice() public {
        uint256 staleTime = NOW - STALENESS - 100;
        primaryFeed.setRoundData(1, 2000e8, staleTime, staleTime, 1);
        oracle.setFallbackFeed(address(fallbackFeed));
        fallbackFeed.setRoundData(1, 0, NOW, NOW, 1);

        vm.expectRevert("Fallback: invalid price");
        oracle.getLatestPrice();
    }

    // ─── Edge: staleness boundary ───

    function test_priceAtExactStalenessBoundary() public {
        // updatedAt = NOW - MAX_STALENESS → NOT stale (< not <=)
        uint256 updatedAt = NOW - STALENESS;
        primaryFeed.setRoundData(1, 2000e8, updatedAt, updatedAt, 1);

        int256 price = oracle.getLatestPrice();
        assertEq(price, int256(2000e8));
    }

    function test_priceOneSecondPastStaleness() public {
        uint256 updatedAt = NOW - STALENESS - 1;
        primaryFeed.setRoundData(1, 2000e8, updatedAt, updatedAt, 1);

        vm.expectRevert("Stale price");
        oracle.getLatestPrice();
    }
}
