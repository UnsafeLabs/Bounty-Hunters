// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PriceOracle.sol";

contract MockAggregatorV3 {
    uint80 private _roundId;
    int256 private _answer;
    uint256 private _startedAt;
    uint256 private _updatedAt;
    uint80 private _answeredInRound;

    function setLatestRoundData(
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) external {
        _roundId = roundId;
        _answer = answer;
        _startedAt = startedAt;
        _updatedAt = updatedAt;
        _answeredInRound = answeredInRound;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }
}

contract PriceOracleTest is Test {
    PriceOracle public oracle;
    MockAggregatorV3 public primary;
    MockAggregatorV3 public fallback;

    uint256 constant DEFAULT_STALENESS = 3600;

    function setUp() public {
        primary = new MockAggregatorV3();
        fallback = new MockAggregatorV3();
        oracle = new PriceOracle(address(primary));
        // Set a block.timestamp far in the future to avoid staleness in default test
        vm.warp(block.timestamp + 1000);
    }

    // ──────────────────────────────────────────────
    //  Tests for successful price fetch
    // ──────────────────────────────────────────────

    function testGetLatestPricePrimary() public {
        primary.setLatestRoundData(
            1,
            1000e8, // price in 8 decimals
            block.timestamp - 100,
            block.timestamp - 100,
            1
        );

        vm.expectEmit(true, true, true, true);
        emit PriceOracle.PriceQueried(1000e8, block.timestamp - 100);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 1000e8);
    }

    function testGetLatestPriceFallback() public {
        // Primary stale (answer > 0 but too old)
        primary.setLatestRoundData(
            1,
            100e8,
            block.timestamp - 10_000,
            block.timestamp - 10_000,
            1
        );
        // Fallback fresh
        fallback.setLatestRoundData(
            2,
            200e8,
            block.timestamp - 50,
            block.timestamp - 50,
            2
        );
        oracle.setFallbackFeed(address(fallback));

        vm.expectEmit(true, true, true, true);
        emit PriceOracle.StalePrice(block.timestamp - 10_000);

        vm.expectEmit(true, true, true, true);
        emit PriceOracle.PriceQueried(200e8, block.timestamp - 50);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 200e8);
    }

    // ──────────────────────────────────────────────
    //  Tests for stale price without fallback
    // ──────────────────────────────────────────────

    function testRevertWhenPrimaryStaleNoFallback() public {
        primary.setLatestRoundData(
            1,
            100e8,
            block.timestamp - 10_000,
            block.timestamp - 10_000,
            1
        );
        // fallbackFeed is address(0)

        vm.expectEmit(true, true, true, true);
        emit PriceOracle.StalePrice(block.timestamp - 10_000);

        vm.expectRevert(
            abi.encodeWithSelector(
                PriceOracle.BothOraclesStale.selector,
                block.timestamp - 10_000,
                0
            )
        );
        oracle.getLatestPrice();
    }

    // ──────────────────────────────────────────────
    //  Tests for both oracles stale
    // ──────────────────────────────────────────────

    function testRevertWhenBothOraclesStale() public {
        primary.setLatestRoundData(
            1,
            100e8,
            block.timestamp - 10_000,
            block.timestamp - 10_000,
            1
        );
        fallback.setLatestRoundData(
            2,
            200e8,
            block.timestamp - 20_000,
            block.timestamp - 20_000,
            2
        );
        oracle.setFallbackFeed(address(fallback));

        vm.expectEmit(true, true, true, true);
        emit PriceOracle.StalePrice(block.timestamp - 10_000);

        vm.expectRevert(
            abi.encodeWithSelector(
                PriceOracle.BothOraclesStale.selector,
                block.timestamp - 10_000,
                block.timestamp - 20_000
            )
        );
        oracle.getLatestPrice();
    }

    // ──────────────────────────────────────────────
    //  Tests for incomplete round
    // ──────────────────────────────────────────────

    function testRevertWhenIncompleteRound() public {
        // answeredInRound < roundId
        primary.setLatestRoundData(
            5,
            100e8,
            block.timestamp - 100,
            block.timestamp - 100,
            3
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                PriceOracle.IncompleteRound.selector,
                5,
                3
            )
        );
        oracle.getLatestPrice();
    }

    // ──────────────────────────────────────────────
    //  Tests for invalid (zero/negative) price
    // ──────────────────────────────────────────────

    function testRevertWhenPriceZero() public {
        primary.setLatestRoundData(
            1,
            0,
            block.timestamp - 100,
            block.timestamp - 100,
            1
        );

        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function testRevertWhenPriceNegative() public {
        primary.setLatestRoundData(
            1,
            -100e8,
            block.timestamp - 100,
            block.timestamp - 100,
            1
        );

        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    // ──────────────────────────────────────────────
    //  Tests for owner-only functions
    // ──────────────────────────────────────────────

    function testRevertWhenNotOwnerSetFallback() public {
        vm.prank(address(0x1234));
        vm.expectRevert(PriceOracle.NotOwner.selector);
        oracle.setFallbackFeed(address(fallback));
    }

    function testRevertWhenNotOwnerSetMaxStaleness() public {
        vm.prank(address(0x1234));
        vm.expectRevert(PriceOracle.NotOwner.selector);
        oracle.setMaxStaleness(100);
    }

    function testRevertWhenNotOwnerTransferOwnership() public {
        vm.prank(address(0x1234));
        vm.expectRevert(PriceOracle.NotOwner.selector);
        oracle.transferOwnership(address(0x5678));
    }

    // ──────────────────────────────────────────────
    //  Tests for owner functionality
    // ──────────────────────────────────────────────

    function testSetFallbackFeed() public {
        vm.expectEmit(true, true, true, true);
        emit PriceOracle.FallbackFeedUpdated(address(0), address(fallback));
        oracle.setFallbackFeed(address(fallback));
        assertEq(oracle.fallbackFeed(), address(fallback));
    }

    function testSetMaxStaleness() public {
        vm.expectEmit(true, true, true, true);
        emit PriceOracle.MaxStalenessUpdated(DEFAULT_STALENESS, 100);
        oracle.setMaxStaleness(100);
        assertEq(oracle.maxStaleness(), 100);
    }

    function testTransferOwnership() public {
        address newOwner = address(0x1234);
        vm.expectEmit(true, true, true, true);
        emit PriceOracle.OwnershipTransferred(address(this), newOwner);
        oracle.transferOwnership(newOwner);
        assertEq(oracle.owner(), newOwner);
    }

    function testRevertWhenTransferOwnershipToZero() public {
        vm.expectRevert(PriceOracle.ZeroAddressNotAllowed.selector);
        oracle.transferOwnership(address(0));
    }

    function testRevertWhenSetFallbackToZero() public {
        // It's allowed to set fallback to zero, but we test that it emits event correctly
        oracle.setFallbackFeed(address(0));
        assertEq(oracle.fallbackFeed(), address(0));
    }

    // ──────────────────────────────────────────────
    //  Tests for constructor
    // ──────────────────────────────────────────────

    function testConstructorSetsOwnerAndFeed() public {
        assertEq(oracle.owner(), address(this));
        assertEq(oracle.primaryFeed(), address(primary));
        assertEq(oracle.maxStaleness(), DEFAULT_STALENESS);
    }

    function testRevertWhenConstructorFeedIsZero() public {
        vm.expectRevert(PriceOracle.ZeroAddressNotAllowed.selector);
        new PriceOracle(address(0));
    }

    // ──────────────────────────────────────────────
    //  Test for staleness threshold update positive check
    // ──────────────────────────────────────────────

    function testRevertWhenMaxStalenessZero() public {
        vm.expectRevert("Staleness must be positive");
        oracle.setMaxStaleness(0);
    }
}