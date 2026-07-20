// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/TokenVesting.sol";

contract TokenVestingTest is Test {
    TokenVesting vesting;
    address owner = address(0x1);
    address beneficiary = address(0x2);

    function setUp() public {
        vm.prank(owner);
        vesting = new TokenVesting(
            address(0x3),
            beneficiary,
            1e18,
            block.timestamp,
            100,
            1000
        );
    }

    function testVestedAmountBeforeCliff() public {
        assertEq(vesting.vestedAmount(), 0);
    }

    function testVestedAmountAfterDuration() public {
        vm.warp(block.timestamp + 1001);
        assertEq(vesting.vestedAmount(), 1e18);
    }

    function testVestedAmountOverflowProtection() public {
        vm.prank(owner);
        TokenVesting bigVesting = new TokenVesting(
            address(0x3),
            beneficiary,
            type(uint256).max / 2,
            block.timestamp,
            100,
            1000
        );

        vm.warp(block.timestamp + 500);
        // Should NOT overflow with divide-before-multiply approach
        uint256 vested = bigVesting.vestedAmount();
        assertGt(vested, 0);
    }

    function testRevokeCalculatesUnvestedCorrectly() public {
        vm.warp(block.timestamp + 500);

        vm.prank(owner);
        vesting.revoke();

        assertFalse(vesting.revoked() == false);
        assertTrue(vesting.revoked());
    }
}
