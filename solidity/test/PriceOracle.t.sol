// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";

contract MockAggregator is AggregatorV3Interface {
    uint80 public roundId;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;
    uint8 public _decimals = 8;

    function setRoundData(
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

    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    ) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }
}

contract PriceOracleTest is Test {
    PriceOracle public oracle;
    MockAggregator public primary;
    MockAggregator public fallback;

    address public owner = address(1);
    address public user = address(2);

    function setUp() public {
        primary = new MockAggregator();
        fallback = new MockAggregator();

        // Set valid primary data
        primary.setRoundData(1, 2000e8, block.timestamp, block.timestamp, 1);

        vm.prank(owner);
        oracle = new PriceOracle(address(primary));
    }

    function test_ValidPrice() public {
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    function test_StalePriceFallback() public {
        // Make primary stale
        primary.setRoundData(1, 2000e8, block.timestamp, block.timestamp - 7200, 1);

        // Set valid fallback
        fallback.setRoundData(1, 1900e8, block.timestamp, block.timestamp, 1);

        vm.prank(owner);
        oracle.setFallbackFeed(address(fallback));

        // Should use fallback and emit StalePrice
        vm.expectEmit(true, true, false, false);
        emit PriceOracle.StalePrice(block.timestamp - 7200, block.timestamp);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 1900e8);
    }

    function test_NegativePriceReverts() public {
        primary.setRoundData(1, -100, block.timestamp, block.timestamp, 1);
        vm.expectRevert("Both oracles stale or invalid");
        oracle.getLatestPrice();
    }

    function test_ZeroPriceReverts() public {
        primary.setRoundData(1, 0, block.timestamp, block.timestamp, 1);
        vm.expectRevert("Both oracles stale or invalid");
        oracle.getLatestPrice();
    }

    function test_IncompleteRoundReverts() public {
        primary.setRoundData(5, 2000e8, block.timestamp, block.timestamp, 3); // answeredInRound < roundId
        vm.expectRevert("Both oracles stale or invalid");
        oracle.getLatestPrice();
    }

    function test_BothOraclesStaleReverts() public {
        primary.setRoundData(1, 2000e8, block.timestamp, block.timestamp - 7200, 1);
        fallback.setRoundData(1, 1900e8, block.timestamp, block.timestamp - 7200, 1);

        vm.prank(owner);
        oracle.setFallbackFeed(address(fallback));

        vm.expectRevert("Both oracles stale or invalid");
        oracle.getLatestPrice();
    }

    function test_MaxStalenessConfigurable() public {
        vm.prank(owner);
        oracle.setMaxStaleness(7200);
        assertEq(oracle.MAX_STALENESS(), 7200);
    }

    function test_MaxStalenessNotOwnerReverts() public {
        vm.prank(user);
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(7200);
    }

    function test_SetFallbackFeedNotOwnerReverts() public {
        vm.prank(user);
        vm.expectRevert("Not owner");
        oracle.setFallbackFeed(address(fallback));
    }
}
