// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/SimpleSwap.sol";

contract SimpleSwapTest is Test {
    SimpleSwap swap;
    address user = address(0x1);

    function setUp() public {
        swap = new SimpleSwap(address(0x3), address(0x4), 30);
    }

    function testSwapRejectsExpiredDeadline() public {
        vm.prank(user);
        vm.expectRevert("Transaction expired");
        swap.swap(address(0x3), 100, 0, block.timestamp - 1);
    }

    function testSwapRejectsZeroAmount() public {
        vm.prank(user);
        vm.expectRevert("Amount must be > 0");
        swap.swap(address(0x3), 0, 0, block.timestamp + 100);
    }

    function testSwapRejectsInvalidToken() public {
        vm.prank(user);
        vm.expectRevert("Invalid token");
        swap.swap(address(0x999), 100, 0, block.timestamp + 100);
    }
}
