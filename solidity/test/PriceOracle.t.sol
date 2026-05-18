// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";

contract MockAggregatorV3 {
    uint80 private roundId;
    int256 private answer;
    uint256 private updatedAt;
    uint80 private answeredInRound;
    uint8 private feedDecimals = 8;

    function setRoundData(
        uint80 _roundId,
        int256 _answer,
        uint256 _updatedAt,
        uint80 _answeredInRound
    ) external {
        roundId = _roundId;
        answer = _answer;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }

    function latestRoundData() external view returns (
        uint80,
        int256,
        uint256,
        uint256,
        uint80
    ) {
        return (roundId, answer, 0, updatedAt, answeredInRound);
    }

    function decimals() external view returns (uint8) {
        return feedDecimals;
    }
}

contract PriceOracleTest is Test {
    PriceOracle private oracle;
    MockAggregatorV3 private primary;
    MockAggregatorV3 private fallbackFeed;

    event StalePrice(address indexed staleFeed, uint256 updatedAt);

    function setUp() public {
        primary = new MockAggregatorV3();
        fallbackFeed = new MockAggregatorV3();
        oracle = new PriceOracle(address(primary), address(fallbackFeed));
    }

    function testValidPrimaryPrice() public {
        primary.setRoundData(10, 2000e8, block.timestamp, 10);
        fallbackFeed.setRoundData(10, 1900e8, block.timestamp, 10);

        assertEq(oracle.getLatestPrice(), 2000e8);
    }

    function testStalePrimaryFallsBackAndEmitsEvent() public {
        uint256 staleTimestamp = block.timestamp - oracle.MAX_STALENESS();
        primary.setRoundData(10, 2000e8, staleTimestamp, 10);
        fallbackFeed.setRoundData(11, 1900e8, block.timestamp, 11);

        vm.expectEmit(true, false, false, true);
        emit StalePrice(address(primary), staleTimestamp);

        assertEq(oracle.getLatestPrice(), 1900e8);
    }

    function testInvalidPriceReverts() public {
        primary.setRoundData(10, 0, block.timestamp, 10);

        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function testNegativePriceReverts() public {
        primary.setRoundData(10, -1, block.timestamp, 10);

        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function testIncompleteRoundReverts() public {
        primary.setRoundData(10, 2000e8, block.timestamp, 9);

        vm.expectRevert("Incomplete round");
        oracle.getLatestPrice();
    }

    function testBothFeedsStaleReverts() public {
        primary.setRoundData(10, 2000e8, block.timestamp - oracle.MAX_STALENESS(), 10);
        fallbackFeed.setRoundData(11, 1900e8, block.timestamp - oracle.MAX_STALENESS(), 11);

        vm.expectRevert("Stale price");
        oracle.getLatestPrice();
    }

    function testOwnerCanConfigureMaxStaleness() public {
        oracle.setMaxStaleness(7200);

        assertEq(oracle.MAX_STALENESS(), 7200);
    }

    function testNonOwnerCannotConfigureMaxStaleness() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(7200);
    }
}
