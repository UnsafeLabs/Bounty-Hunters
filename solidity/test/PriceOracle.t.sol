// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/PriceOracle.sol";

interface Vm {
    function warp(uint256 timestamp) external;
}

contract MockAggregator {
    int256 private answer;
    uint256 private updatedAt;
    uint80 private roundId;
    uint80 private answeredInRound;

    function setRound(int256 _answer, uint256 _updatedAt, uint80 _roundId, uint80 _answeredInRound) external {
        answer = _answer;
        updatedAt = _updatedAt;
        roundId = _roundId;
        answeredInRound = _answeredInRound;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }
}

contract PriceOracleTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testValidPrice() public {
        MockAggregator primary = new MockAggregator();
        primary.setRound(123_45000000, 10_000, 7, 7);
        vm.warp(10_100);
        PriceOracle oracle = new PriceOracle(address(primary));
        require(oracle.getLatestPrice() == 123_45000000, "valid price mismatch");
    }

    function testStalePrimaryUsesFallback() public {
        vm.warp(10_000);
        MockAggregator primary = new MockAggregator();
        MockAggregator fallbackFeed = new MockAggregator();
        primary.setRound(100, 1, 1, 1);
        fallbackFeed.setRound(200, 9_999, 2, 2);
        PriceOracle oracle = new PriceOracle(address(primary));
        oracle.setFallbackFeed(address(fallbackFeed));
        require(oracle.getLatestPrice() == 200, "fallback price mismatch");
    }

    function testNegativePriceReverts() public {
        MockAggregator primary = new MockAggregator();
        primary.setRound(-1, 10_000, 1, 1);
        vm.warp(10_001);
        PriceOracle oracle = new PriceOracle(address(primary));
        (bool ok, ) = address(oracle).call(abi.encodeWithSelector(oracle.getLatestPrice.selector));
        require(!ok, "negative price accepted");
    }

    function testIncompleteRoundReverts() public {
        MockAggregator primary = new MockAggregator();
        primary.setRound(100, 10_000, 3, 2);
        vm.warp(10_001);
        PriceOracle oracle = new PriceOracle(address(primary));
        (bool ok, ) = address(oracle).call(abi.encodeWithSelector(oracle.getLatestPrice.selector));
        require(!ok, "incomplete round accepted");
    }

    function testBothStaleReverts() public {
        vm.warp(10_000);
        MockAggregator primary = new MockAggregator();
        MockAggregator fallbackFeed = new MockAggregator();
        primary.setRound(100, 1, 1, 1);
        fallbackFeed.setRound(200, 2, 2, 2);
        PriceOracle oracle = new PriceOracle(address(primary));
        oracle.setFallbackFeed(address(fallbackFeed));
        (bool ok, ) = address(oracle).call(abi.encodeWithSelector(oracle.getLatestPrice.selector));
        require(!ok, "both stale feeds accepted");
    }
}
