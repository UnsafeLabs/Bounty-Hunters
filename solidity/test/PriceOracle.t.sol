// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";

contract MockAggregator is AggregatorV3Interface {
    uint80 internal _roundId;
    int256 internal _answer;
    uint256 internal _startedAt;
    uint256 internal _updatedAt;
    uint80 internal _answeredInRound;
    uint8 internal _decimals;

    function setRoundData(
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

    function setDecimals(uint8 decimals_) external {
        _decimals = decimals_;
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
    PriceOracle public oracle;
    MockAggregator public primaryMock;
    MockAggregator public fallbackMock;

    uint256 constant BASE_TIME = 1_000_000;

    function setUp() public {
        vm.warp(BASE_TIME);
        primaryMock = new MockAggregator();
        fallbackMock = new MockAggregator();
        oracle = new PriceOracle(address(primaryMock), address(fallbackMock));
        primaryMock.setDecimals(8);
        fallbackMock.setDecimals(8);
    }

    // Test: valid price from primary oracle
    function test_validPriceFromPrimary() public {
        primaryMock.setRoundData(1, 2000e8, BASE_TIME, BASE_TIME, 1);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    // Test: zero price reverts
    function test_zeroPriceReverts() public {
        primaryMock.setRoundData(1, 0, BASE_TIME, BASE_TIME, 1);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    // Test: negative price reverts
    function test_negativePriceReverts() public {
        primaryMock.setRoundData(1, -100, BASE_TIME, BASE_TIME, 1);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    // Test: incomplete round reverts
    function test_incompleteRoundReverts() public {
        primaryMock.setRoundData(5, 2000e8, BASE_TIME, BASE_TIME, 3);
        vm.expectRevert("Round not complete");
        oracle.getLatestPrice();
    }

    // Test: stale price falls back to secondary oracle
    function test_stalePriceFallsBackToSecondary() public {
        uint256 staleTime = BASE_TIME - 7200;
        primaryMock.setRoundData(1, 2000e8, staleTime, staleTime, 1);
        fallbackMock.setRoundData(1, 2100e8, BASE_TIME, BASE_TIME, 1);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 2100e8);
    }

    // Test: stale price emits StalePrice event
    function test_stalePriceEmitsEvent() public {
        uint256 staleTime = BASE_TIME - 7200;
        primaryMock.setRoundData(1, 2000e8, staleTime, staleTime, 1);
        fallbackMock.setRoundData(1, 2100e8, BASE_TIME, BASE_TIME, 1);

        vm.expectEmit(true, false, false, true);
        emit PriceOracle.StalePrice(staleTime, BASE_TIME);
        oracle.getLatestPrice();
    }

    // Test: both oracles stale reverts
    function test_bothOraclesStaleReverts() public {
        uint256 staleTime = BASE_TIME - 7200;
        primaryMock.setRoundData(1, 2000e8, staleTime, staleTime, 1);
        fallbackMock.setRoundData(1, 2100e8, staleTime, staleTime, 1);

        vm.expectRevert("Both oracles stale");
        oracle.getLatestPrice();
    }

    // Test: fallback zero price reverts
    function test_fallbackZeroPriceReverts() public {
        uint256 staleTime = BASE_TIME - 7200;
        primaryMock.setRoundData(1, 2000e8, staleTime, staleTime, 1);
        fallbackMock.setRoundData(1, 0, BASE_TIME, BASE_TIME, 1);

        vm.expectRevert("Fallback invalid price");
        oracle.getLatestPrice();
    }

    // Test: fallback incomplete round reverts
    function test_fallbackIncompleteRoundReverts() public {
        uint256 staleTime = BASE_TIME - 7200;
        primaryMock.setRoundData(1, 2000e8, staleTime, staleTime, 1);
        fallbackMock.setRoundData(5, 2100e8, BASE_TIME, BASE_TIME, 3);

        vm.expectRevert("Fallback round not complete");
        oracle.getLatestPrice();
    }

    // Test: owner can set max staleness
    function test_ownerCanSetMaxStaleness() public {
        oracle.setMaxStaleness(7200);
        assertEq(oracle.MAX_STALENESS(), 7200);
    }

    // Test: non-owner cannot set max staleness
    function test_nonOwnerCannotSetMaxStaleness() public {
        vm.prank(address(0xdead));
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(7200);
    }

    // Test: price just under staleness boundary returns primary
    function test_priceJustUnderStaleness() public {
        uint256 recentTime = BASE_TIME - 3599;
        primaryMock.setRoundData(1, 2000e8, recentTime, recentTime, 1);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    // Test: price at staleness boundary falls back
    function test_priceAtStalenessBoundary() public {
        uint256 staleTime = BASE_TIME - 3600;
        primaryMock.setRoundData(1, 2000e8, staleTime, staleTime, 1);
        fallbackMock.setRoundData(1, 2100e8, BASE_TIME, BASE_TIME, 1);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 2100e8);
    }

    // Test: getDecimals returns primary feed decimals
    function test_getDecimals() public {
        uint8 dec = oracle.getDecimals();
        assertEq(dec, 8);
    }
}
