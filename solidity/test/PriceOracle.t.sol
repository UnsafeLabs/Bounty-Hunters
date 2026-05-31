// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/PriceOracle.sol";

interface Vm {
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData) external;
    function expectRevert(bytes calldata revertData) external;
    function warp(uint256 newTimestamp) external;
}

contract MockAggregatorV3 is AggregatorV3Interface {
    uint80 private roundId = 1;
    int256 private answer = 1;
    uint256 private startedAt = 1;
    uint256 private updatedAt = 1;
    uint80 private answeredInRound = 1;
    uint8 private feedDecimals = 8;

    function setRoundData(
        uint80 _roundId,
        int256 _answer,
        uint256 _updatedAt,
        uint80 _answeredInRound
    ) external {
        roundId = _roundId;
        answer = _answer;
        startedAt = _updatedAt;
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
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function decimals() external view returns (uint8) {
        return feedDecimals;
    }
}

contract PriceOracleTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event StalePrice(uint256 primaryUpdatedAt);

    MockAggregatorV3 private primary;
    MockAggregatorV3 private fallbackOracle;
    PriceOracle private oracle;

    function setUp() public {
        vm.warp(10_000);
        primary = new MockAggregatorV3();
        fallbackOracle = new MockAggregatorV3();
        oracle = new PriceOracle(address(primary), address(fallbackOracle));
    }

    function testValidPrimaryPriceReturnsWithoutFallback() public {
        primary.setRoundData(10, 2_000e8, block.timestamp - 10, 10);
        fallbackOracle.setRoundData(20, 1_000e8, block.timestamp - 10, 20);

        require(oracle.getLatestPrice() == 2_000e8, "wrong primary price");
    }

    function testStalePrimaryFallsBackAndEmitsEvent() public {
        uint256 staleUpdatedAt = block.timestamp - 3_700;
        primary.setRoundData(10, 2_000e8, staleUpdatedAt, 10);
        fallbackOracle.setRoundData(20, 1_950e8, block.timestamp - 10, 20);

        vm.expectEmit(false, false, false, true);
        emit StalePrice(staleUpdatedAt);

        require(oracle.getLatestPrice() == 1_950e8, "wrong fallback price");
    }

    function testNegativePriceReverts() public {
        primary.setRoundData(10, -1, block.timestamp - 10, 10);

        vm.expectRevert(bytes("Invalid price"));
        oracle.getLatestPrice();
    }

    function testIncompleteRoundReverts() public {
        primary.setRoundData(10, 2_000e8, block.timestamp - 10, 9);

        vm.expectRevert(bytes("Incomplete round"));
        oracle.getLatestPrice();
    }

    function testBothOraclesStaleReverts() public {
        primary.setRoundData(10, 2_000e8, block.timestamp - 3_700, 10);
        fallbackOracle.setRoundData(20, 1_950e8, block.timestamp - 4_000, 20);

        vm.expectRevert(bytes("Stale price"));
        oracle.getLatestPrice();
    }

    function testOwnerCanConfigureMaxStaleness() public {
        primary.setRoundData(10, 2_000e8, block.timestamp - 3_700, 10);
        oracle.setMaxStaleness(7_200);

        require(oracle.getLatestPrice() == 2_000e8, "configurable staleness ignored");
    }
}
