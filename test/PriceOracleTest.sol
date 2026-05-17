// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/PriceOracle.sol";

contract MockAggregator is AggregatorV3Interface {
    uint80 public roundId;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;
    uint8 public decimals_;

    function setLatestRoundData(
        uint80 _roundId,
        int256 _answer,
        uint256 _startedAt,
        uint256 _updatedAt,
        uint80 _answeredInRound
    ) external {
        roundId = _roundId;
        answer = _answer;
        startedAt = _startedAt;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }

    function latestRoundData() external view override returns (
        uint80,
        int256,
        uint256,
        uint256,
        uint80
    ) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function decimals() external view override returns (uint8) {
        return decimals_;
    }
}

contract PriceOracleTest is Test {
    PriceOracle oracle;
    MockAggregator primary;
    MockAggregator secondary;

    uint256 constant MAX_STALENESS = 3600;

    function setUp() public {
        primary = new MockAggregator();
        secondary = new MockAggregator();
        oracle = new PriceOracle(address(primary));
        oracle.setFallbackFeed(address(secondary));
    }

    function testValidPrice() public {
        primary.setLatestRoundData(1, 1000e8, 0, block.timestamp, 1);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 1000e8);
    }

    function testStalePriceFallsBack() public {
        uint256 staleTime = block.timestamp - MAX_STALENESS - 1;
        primary.setLatestRoundData(1, 1000e8, 0, staleTime, 1);
        secondary.setLatestRoundData(1, 2000e8, 0, block.timestamp, 1);
        vm.expectEmit(true, false, false, false);
        emit StalePrice(staleTime);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    function testNegativePriceReverts() public {
        primary.setLatestRoundData(1, -1, 0, block.timestamp, 1);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function testZeroPriceReverts() public {
        primary.setLatestRoundData(1, 0, 0, block.timestamp, 1);
        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function testIncompleteRoundReverts() public {
        primary.setLatestRoundData(2, 1000e8, 0, block.timestamp, 1); // answeredInRound < roundId
        vm.expectRevert("Incomplete round");
        oracle.getLatestPrice();
    }

    function testBothOraclesStaleReverts() public {
        uint256 staleTime = block.timestamp - MAX_STALENESS - 1;
        primary.setLatestRoundData(1, 1000e8, 0, staleTime, 1);
        secondary.setLatestRoundData(1, 2000e8, 0, staleTime, 1);
        vm.expectRevert("Both oracles stale");
        oracle.getLatestPrice();
    }

    function testFallbackNotSetReverts() public {
        PriceOracle noFallback = new PriceOracle(address(primary));
        primary.setLatestRoundData(1, 1000e8, 0, block.timestamp - MAX_STALENESS - 1, 1);
        vm.expectRevert("No fallback set");
        noFallback.getLatestPrice();
    }

    function testConfigurableMaxStaleness() public {
        oracle.setMaxStaleness(100);
        primary.setLatestRoundData(1, 1000e8, 0, block.timestamp - 50, 1); // 50 < 100, not stale
        int256 price = oracle.getLatestPrice();
        assertEq(price, 1000e8);
    }
}
