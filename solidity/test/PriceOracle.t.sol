// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";
import "./MockV3Aggregator.sol";

contract PriceOracleTest is Test {
    PriceOracle public oracle;
    MockV3Aggregator public primary;
    MockV3Aggregator public secondary;

    uint8 constant DECIMALS = 8;
    int256 constant VALID_PRICE = 2000e8;
    int256 constant FALLBACK_PRICE = 1999e8;

    event StalePrice(uint256 lastUpdate, uint256 currentTime);
    event PriceQueried(int256 price, uint256 timestamp);

    function setUp() public {
        primary = new MockV3Aggregator(DECIMALS, VALID_PRICE);
        secondary = new MockV3Aggregator(DECIMALS, FALLBACK_PRICE);
        oracle = new PriceOracle(address(primary), address(secondary));
    }

    function test_validPrice() public {
        int256 price = oracle.getLatestPrice();
        assertEq(price, VALID_PRICE);
    }

    function test_stalePrimaryUsesFallbackAndEmits() public {
        uint256 staleTime = block.timestamp - 3601;
        primary.updateRoundData(1, VALID_PRICE, staleTime, staleTime, 1);
        secondary.updateRoundData(1, FALLBACK_PRICE, block.timestamp, block.timestamp, 1);

        vm.expectEmit(true, true, true, true);
        emit StalePrice(staleTime, block.timestamp);

        int256 price = oracle.getLatestPrice();
        assertEq(price, FALLBACK_PRICE);
    }

    function test_negativePriceReverts() public {
        primary.updateRoundData(2, -1, block.timestamp, block.timestamp, 2);
        vm.expectRevert(bytes("Invalid price"));
        oracle.getLatestPrice();
    }

    function test_zeroPriceReverts() public {
        primary.updateRoundData(3, 0, block.timestamp, block.timestamp, 3);
        vm.expectRevert(bytes("Invalid price"));
        oracle.getLatestPrice();
    }

    function test_incompleteRoundReverts() public {
        // answeredInRound < roundId
        primary.updateRoundData(10, VALID_PRICE, block.timestamp, block.timestamp, 9);
        vm.expectRevert(bytes("Incomplete round"));
        oracle.getLatestPrice();
    }

    function test_bothOraclesStaleReverts() public {
        uint256 staleTime = block.timestamp - 7200;
        primary.updateRoundData(1, VALID_PRICE, staleTime, staleTime, 1);
        secondary.updateRoundData(1, FALLBACK_PRICE, staleTime, staleTime, 1);

        vm.expectRevert(bytes("Stale price"));
        oracle.getLatestPrice();
    }

    function test_ownerCanSetMaxStaleness() public {
        oracle.setMaxStaleness(7200);
        assertEq(oracle.MAX_STALENESS(), 7200);

        // 4000s old is stale under default 3600 but fresh under 7200
        uint256 t = block.timestamp - 4000;
        primary.updateRoundData(5, VALID_PRICE, t, t, 5);
        int256 price = oracle.getLatestPrice();
        assertEq(price, VALID_PRICE);
    }

    function test_nonOwnerCannotSetMaxStaleness() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(bytes("Not owner"));
        oracle.setMaxStaleness(1);
    }
}
