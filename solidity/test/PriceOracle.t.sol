// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";

contract PriceOracleTest is Test {
    PriceOracle oracle;
    address owner = address(0x1);
    address mockFeed = address(0x2);
    address fallbackFeed = address(0x3);

    function setUp() public {
        oracle = new PriceOracle(mockFeed);
    }

    function testSetFallbackFeed() public {
        vm.prank(owner);
        oracle.setFallbackFeed(fallbackFeed);
        assertEq(address(oracle.fallbackFeed()), fallbackFeed);
    }

    function testSetFallbackFeedOnlyOwner() public {
        vm.prank(address(0x999));
        vm.expectRevert("Not owner");
        oracle.setFallbackFeed(fallbackFeed);
    }

    function testSetMaxStaleness() public {
        vm.prank(owner);
        oracle.setMaxStaleness(7200);
        assertEq(oracle.MAX_STALENESS(), 7200);
    }

    function testSetMaxStalenessOnlyOwner() public {
        vm.prank(address(0x999));
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(7200);
    }
}
