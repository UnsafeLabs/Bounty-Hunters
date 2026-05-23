// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/TokenVesting.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    constructor() ERC20("Test", "TST") {
        _mint(msg.sender, 10_000_000e18);
    }
}

contract TokenVestingTest is Test {
    TestToken public token;
    TokenVesting public vesting;
    address public beneficiary = address(0x123);
    address public owner;
    uint256 constant START = 1000;
    uint256 constant CLIFF = 100;
    uint256 constant DURATION = 1000;
    uint256 constant ALLOCATION = 1_000_000e18;

    function setUp() public {
        token = new TestToken();
        owner = address(this);
        vesting = new TokenVesting(
            address(token), beneficiary, ALLOCATION,
            START, CLIFF, DURATION
        );
        token.transfer(address(vesting), ALLOCATION);
    }

    function test_NoVestingBeforeCliff() public {
        vm.warp(START + CLIFF - 1);
        assertEq(vesting.vestedAmount(), 0);
    }

    function test_FullVestingAtEnd() public {
        vm.warp(START + DURATION);
        assertEq(vesting.vestedAmount(), ALLOCATION);
    }

    function test_PartialVestingMidpoint() public {
        vm.warp(START + DURATION / 2);
        uint256 vested = vesting.vestedAmount();
        assertApproxEqRel(vested, ALLOCATION / 2, 0.01e18);
    }

    function test_ClaimPartial() public {
        vm.warp(START + DURATION / 2);
        vm.startPrank(beneficiary);
        uint256 amount = vesting.claimable();
        vesting.claim();
        vm.stopPrank();
        assertEq(token.balanceOf(beneficiary), amount);
        assertEq(vesting.claimed(), amount);
    }

    function test_ClaimFullAtEnd() public {
        vm.warp(START + DURATION + 1);
        vm.prank(beneficiary);
        vesting.claim();
        assertEq(token.balanceOf(beneficiary), ALLOCATION);
        assertEq(vesting.claimed(), ALLOCATION);
    }

    function test_RevokeDuringCliff() public {
        vm.warp(START + CLIFF - 1);
        vesting.revoke();
        assertTrue(vesting.revoked());
        assertEq(token.balanceOf(owner), 10_000_000e18);
        assertEq(token.balanceOf(beneficiary), 0);
    }

    function test_RevokeAfterPartialVesting() public {
        vm.warp(START + DURATION / 2);
        vm.prank(beneficiary);
        vesting.claim();
        uint256 claimed = vesting.claimed();

        vesting.revoke();
        assertEq(token.balanceOf(owner), 10_000_000e18 - ALLOCATION + (ALLOCATION - claimed));
    }

    function test_MaxAllocationNoOverflow() public {
        TokenVesting bigVesting = new TokenVesting(
            address(token), beneficiary, type(uint256).max,
            START, CLIFF, DURATION
        );
        vm.warp(START + DURATION / 2);
        uint256 vested = bigVesting.vestedAmount();
        assertTrue(vested > 0);
    }

    function test_RestrictedClaim() public {
        vm.warp(START + DURATION / 2);
        vm.expectRevert("Not beneficiary");
        vesting.claim();
    }

    function test_RestrictedRevoke() public {
        vm.warp(START + DURATION / 2);
        vm.prank(beneficiary);
        vm.expectRevert("Not owner");
        vesting.revoke();
    }
}
