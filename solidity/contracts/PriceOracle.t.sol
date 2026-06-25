// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "./PriceOracle.sol";

contract MockAggregator is AggregatorV3Interface {
    uint80 private _roundId;
    int256 private _answer;
    uint256 private _startedAt;
    uint256 private _updatedAt;
    uint80 private _answeredInRound;
    uint8 private _decimals;

    function setLatestRoundData(uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) external {
        _roundId = roundId;
        _answer = answer;
        _startedAt = startedAt;
        _updatedAt = updatedAt;
        _answeredInRound = answeredInRound;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }

    function setDecimals(uint8 d) external { _decimals = d; }
    function decimals() external view returns (uint8) { return _decimals; }
}

contract PriceOracleTest is Test {
    MockAggregator primary;
    MockAggregator secondary;
    PriceOracle oracle;

    uint256 constant ONE_HOUR = 3600;

    function setUp() public {
        primary = new MockAggregator();
        secondary = new MockAggregator();
        oracle = new PriceOracle(address(primary), address(secondary));

        primary.setDecimals(8);
        secondary.setDecimals(8);
    }

    function test_ValidPrice() public {
        uint256 nowish = block.timestamp;
        primary.setLatestRoundData(1, 2000e8, nowish - 100, nowish - 30, 1);
        secondary.setLatestRoundData(1, 2000e8, nowish - 100, nowish - 30, 1);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    function test_NegativePriceReverts() public {
        uint256 nowish = block.timestamp;
        primary.setLatestRoundData(1, -100, nowish - 100, nowish - 30, 1);

        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function test_ZeroPriceReverts() public {
        uint256 nowish = block.timestamp;
        primary.setLatestRoundData(1, 0, nowish - 100, nowish - 30, 1);

        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function test_IncompleteRoundReverts() public {
        uint256 nowish = block.timestamp;
        primary.setLatestRoundData(5, 2000e8, nowish - 100, nowish - 30, 3);

        vm.expectRevert("Incomplete round");
        oracle.getLatestPrice();
    }

    function test_StalePriceFallsBackToSecondary() public {
        uint256 nowish = block.timestamp;
        primary.setLatestRoundData(1, 2000e8, nowish - 2 * ONE_HOUR, nowish - 2 * ONE_HOUR, 1);
        secondary.setLatestRoundData(1, 1900e8, nowish - 100, nowish - 30, 1);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 1900e8);
    }

    function test_BothOraclesStaleReverts() public {
        uint256 nowish = block.timestamp;
        primary.setLatestRoundData(1, 2000e8, nowish - 2 * ONE_HOUR, nowish - 2 * ONE_HOUR, 1);
        secondary.setLatestRoundData(1, 1900e8, nowish - 2 * ONE_HOUR, nowish - 2 * ONE_HOUR, 1);

        vm.expectRevert("Both oracles stale");
        oracle.getLatestPrice();
    }

    function test_StalePriceEmitsEvent() public {
        uint256 nowish = block.timestamp;
        primary.setLatestRoundData(1, 2000e8, nowish - 2 * ONE_HOUR, nowish - 2 * ONE_HOUR, 1);
        secondary.setLatestRoundData(1, 1900e8, nowish - 100, nowish - 30, 1);

        vm.expectEmit(true, false, false, false);
        emit PriceOracle.StalePrice(nowish - 2 * ONE_HOUR);
        oracle.getLatestPrice();
    }

    function test_SecondaryIncompleteRoundReverts() public {
        uint256 nowish = block.timestamp;
        primary.setLatestRoundData(1, 2000e8, nowish - 2 * ONE_HOUR, nowish - 2 * ONE_HOUR, 1);
        secondary.setLatestRoundData(5, 1900e8, nowish - 100, nowish - 30, 3);

        vm.expectRevert("Incomplete round");
        oracle.getLatestPrice();
    }

    function test_SecondaryNegativePriceReverts() public {
        uint256 nowish = block.timestamp;
        primary.setLatestRoundData(1, 2000e8, nowish - 2 * ONE_HOUR, nowish - 2 * ONE_HOUR, 1);
        secondary.setLatestRoundData(1, -100, nowish - 100, nowish - 30, 1);

        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function test_SetMaxStaleness() public {
        oracle.setMaxStaleness(7200);
        assertEq(oracle.MAX_STALENESS(), 7200);
    }

    function test_SetSecondaryFeed() public {
        MockAggregator newSecondary = new MockAggregator();
        oracle.setSecondaryFeed(address(newSecondary));
        assertEq(address(oracle.secondaryFeed()), address(newSecondary));
    }
}
