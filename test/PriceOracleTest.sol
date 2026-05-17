// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/PriceOracle.sol";

contract MockAggregator {
    uint80 public roundId;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function decimals() external view returns (uint8) { return 8; }

    function setData(uint80 _roundId, int256 _answer, uint256 _startedAt, uint256 _updatedAt, uint80 _answeredInRound) external {
        roundId = _roundId;
        answer = _answer;
        startedAt = _startedAt;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }
}

contract PriceOracleTest is Test {
    PriceOracle oracle;
    MockAggregator primary;
    MockAggregator secondary;

    event StalePrice(uint256 indexed roundTimestamp);

    function setUp() public {
        primary = new MockAggregator();
        secondary = new MockAggregator();
        oracle = new PriceOracle(address(primary));
        oracle.setSecondaryFeed(address(secondary));
    }

    function testValidPrice() public {
        primary.setData(1, 1000e8, 0, block.timestamp, 1);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 1000e8);
    }

    function testStalePriceFallback() public {
        // Primary stale ( > 1 hour)
        primary.setData(1, 1000e8, 0, block.timestamp - 4000, 1);
        // Secondary valid
        secondary.setData(1, 2000e8, 0, block.timestamp, 1);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    function testNegativePriceFallback() public {
        primary.setData(1, -100, 0, block.timestamp, 1);
        secondary.setData(1, 2000e8, 0, block.timestamp, 1);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    function testIncompleteRoundFallback() public {
        // answeredInRound < roundId => incomplete
        primary.setData(1, 1000e8, 0, block.timestamp, 0);
        secondary.setData(1, 2000e8, 0, block.timestamp, 1);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    function testBothOraclesStaleReverts() public {
        primary.setData(1, 1000e8, 0, block.timestamp - 4000, 1);
        secondary.setData(1, 2000e8, 0, block.timestamp - 5000, 1);
        vm.expectRevert("Both oracles stale");
        oracle.getLatestPrice();
    }

    function testStalePriceEvent() public {
        primary.setData(1, 1000e8, 0, block.timestamp - 4000, 1);
        secondary.setData(1, 2000e8, 0, block.timestamp, 1);
        vm.expectEmit(true, false, false, false);
        emit StalePrice(block.timestamp - 4000);
        oracle.getLatestPrice();
    }
}
