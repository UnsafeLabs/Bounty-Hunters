// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";

contract MockAggregator is AggregatorV3Interface {
    uint80 public mockRoundId;
    int256 public mockAnswer;
    uint256 public mockStartedAt;
    uint256 public mockUpdatedAt;
    uint80 public mockAnsweredInRound;
    uint8 public mockDecimals = 8;

    function setLatestRoundData(
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) external {
        mockRoundId = roundId;
        mockAnswer = answer;
        mockStartedAt = startedAt;
        mockUpdatedAt = updatedAt;
        mockAnsweredInRound = answeredInRound;
    }

    function latestRoundData() external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (mockRoundId, mockAnswer, mockStartedAt, mockUpdatedAt, mockAnsweredInRound);
    }

    function decimals() external view override returns (uint8) {
        return mockDecimals;
    }
}

contract PriceOracleTest is Test {
    event StalePrice(uint256 primaryUpdatedAt);

    PriceOracle public oracle;
    MockAggregator public primary;
    MockAggregator public secondary;

    uint256 constant FRESH_TIME = 1000;
    uint256 constant WARP_TIME = 1100;
    uint256 constant MAX_STALENESS = 3600;
    int256 constant VALID_PRICE = 2000e8;
    int256 constant FALLBACK_PRICE = 1990e8;

    function setUp() public {
        primary = new MockAggregator();
        secondary = new MockAggregator();

        primary.setLatestRoundData(1, VALID_PRICE, FRESH_TIME, FRESH_TIME, 1);
        secondary.setLatestRoundData(1, VALID_PRICE, FRESH_TIME, FRESH_TIME, 1);

        vm.warp(WARP_TIME);
        oracle = new PriceOracle(address(primary), address(secondary));
    }

    function testValidPrice() public {
        assertEq(oracle.getLatestPrice(), VALID_PRICE);
    }

    function testStalePrimaryUsesFallback() public {
        uint256 staleTime = FRESH_TIME;
        vm.warp(staleTime + MAX_STALENESS + 1);
        primary.setLatestRoundData(1, VALID_PRICE, staleTime, staleTime, 1);
        secondary.setLatestRoundData(1, FALLBACK_PRICE, staleTime, staleTime + MAX_STALENESS - 1, 1);

        vm.expectEmit(true, true, true, true);
        emit StalePrice(staleTime);
        assertEq(oracle.getLatestPrice(), FALLBACK_PRICE);
    }

    function testStalePrimaryNegativePriceUsesFallback() public {
        primary.setLatestRoundData(1, -100, FRESH_TIME, FRESH_TIME, 1);
        secondary.setLatestRoundData(1, 1900e8, FRESH_TIME, FRESH_TIME + 1, 1);

        vm.expectEmit(true, true, true, true);
        emit StalePrice(FRESH_TIME);
        assertEq(oracle.getLatestPrice(), 1900e8);
    }

    function testStalePrimaryIncompleteRoundUsesFallback() public {
        primary.setLatestRoundData(2, VALID_PRICE, FRESH_TIME, FRESH_TIME, 1);
        secondary.setLatestRoundData(1, 1800e8, FRESH_TIME, FRESH_TIME + 1, 1);

        vm.expectEmit(true, true, true, true);
        emit StalePrice(FRESH_TIME);
        assertEq(oracle.getLatestPrice(), 1800e8);
    }

    function testBothOraclesStaleReverts() public {
        uint256 staleTime = FRESH_TIME;
        vm.warp(staleTime + MAX_STALENESS + 1);
        primary.setLatestRoundData(1, VALID_PRICE, staleTime, staleTime, 1);
        secondary.setLatestRoundData(1, VALID_PRICE, staleTime, staleTime, 1);

        vm.expectRevert("Both oracles stale");
        oracle.getLatestPrice();
    }

    function testBothOraclesNegativePriceReverts() public {
        primary.setLatestRoundData(1, -1, FRESH_TIME, FRESH_TIME, 1);
        secondary.setLatestRoundData(1, -1, FRESH_TIME, FRESH_TIME, 1);

        vm.expectRevert("Both oracles stale");
        oracle.getLatestPrice();
    }

    function testBothOraclesIncompleteRoundReverts() public {
        primary.setLatestRoundData(2, VALID_PRICE, FRESH_TIME, FRESH_TIME, 1);
        secondary.setLatestRoundData(2, VALID_PRICE, FRESH_TIME, FRESH_TIME, 1);

        vm.expectRevert("Both oracles stale");
        oracle.getLatestPrice();
    }

    function testZeroPriceIsRejected() public {
        primary.setLatestRoundData(1, 0, FRESH_TIME, FRESH_TIME, 1);
        secondary.setLatestRoundData(1, 2000e8, FRESH_TIME, FRESH_TIME + 1, 1);

        vm.expectEmit(true, true, true, true);
        emit StalePrice(FRESH_TIME);
        assertEq(oracle.getLatestPrice(), 2000e8);
    }

    function testConfigurableMaxStaleness() public {
        oracle.setMaxStaleness(7200);
        assertEq(oracle.MAX_STALENESS(), 7200);
    }

    function testSetMaxStalenessOnlyOwner() public {
        vm.prank(address(0xdead));
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(500);
    }

    function testGetDecimals() public view {
        assertEq(oracle.getDecimals(), 8);
    }
}
