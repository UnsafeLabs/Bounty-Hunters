// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/FlashLoan.sol";

contract FlashLoanTest is Test {
    FlashLoan flash;
    address owner = address(0x1);
    address user = address(0x2);

    function setUp() public {
        flash = new FlashLoan(address(0x3), 30);
    }

    function testMaxLoanRatioDefault() public {
        assertEq(flash.maxLoanRatio(), 50);
    }

    function testSetMaxLoanRatio() public {
        vm.prank(owner);
        flash.setMaxLoanRatio(30);
        assertEq(flash.maxLoanRatio(), 30);
    }

    function testSetMaxLoanRatioRejectsOver100() public {
        vm.prank(owner);
        vm.expectRevert("Cannot exceed 100%");
        flash.setMaxLoanRatio(101);
    }

    function testSetPaused() public {
        vm.prank(owner);
        flash.setPaused(true);
        assertTrue(flash.paused());

        vm.prank(owner);
        flash.setPaused(false);
        assertFalse(flash.paused());
    }

    function testSetPausedOnlyOwner() public {
        vm.prank(user);
        vm.expectRevert("Not owner");
        flash.setPaused(true);
    }
}
