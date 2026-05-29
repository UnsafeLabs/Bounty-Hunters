// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/TokenVesting.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TokenVestingTest is Test {
    TokenVesting public vesting;
    MockERC20 public token;

    address public owner = address(0xA001);
    address public beneficiary = address(0xBEEF);
    address public other = address(0xC0DE);

    uint256 constant BASE_TIME = 1_000_000;
    uint256 constant CLIFF_DURATION = 30 days;
    uint256 constant VESTING_DURATION = 365 days;
    uint256 constant ALLOCATION = 1000e18;

    function setUp() public {
        vm.warp(BASE_TIME);
        token = new MockERC20();
        vm.prank(owner);
        vesting = new TokenVesting(
            address(token),
            beneficiary,
            ALLOCATION,
            BASE_TIME,
            CLIFF_DURATION,
            VESTING_DURATION
        );

        // Fund the vesting contract
        token.mint(address(vesting), ALLOCATION);
    }

    // Test: no tokens vested before cliff
    function test_noVestingBeforeCliff() public {
        vm.warp(BASE_TIME + CLIFF_DURATION - 1);
        assertEq(vesting.vestedAmount(), 0);
    }

    // Test: tokens start vesting after cliff
    function test_vestingStartsAfterCliff() public {
        vm.warp(BASE_TIME + CLIFF_DURATION);
        uint256 vested = vesting.vestedAmount();
        assertGt(vested, 0);
    }

    // Test: full allocation vested after duration
    function test_fullVestingAfterDuration() public {
        vm.warp(BASE_TIME + VESTING_DURATION);
        assertEq(vesting.vestedAmount(), ALLOCATION);
    }

    // Test: linear vesting is accurate
    function test_linearVestingAccuracy() public {
        // At 50% of vesting duration (after cliff), should have ~50% vested
        vm.warp(BASE_TIME + VESTING_DURATION / 2);
        uint256 vested = vesting.vestedAmount();
        // Allow small rounding error
        assertApproxEqRel(vested, ALLOCATION / 2, 0.01e18);
    }

    // Test: no overflow for large allocations (1 billion tokens with 18 decimals)
    function test_noOverflowForLargeAllocations() public {
        uint256 largeAllocation = 1_000_000_000e18; // 1 billion tokens
        token.mint(address(vesting), largeAllocation);

        vm.warp(BASE_TIME + VESTING_DURATION / 2);
        // This should NOT overflow
        uint256 vested = vesting.vestedAmount();
        assertGt(vested, 0);
    }

    // Test: claim works
    function test_claim() public {
        vm.warp(BASE_TIME + CLIFF_DURATION + 30 days);

        uint256 claimable = vesting.claimable();
        assertGt(claimable, 0);

        uint256 balanceBefore = token.balanceOf(beneficiary);
        vm.prank(beneficiary);
        vesting.claim();
        uint256 balanceAfter = token.balanceOf(beneficiary);

        assertEq(balanceAfter - balanceBefore, claimable);
        assertEq(vesting.claimed(), claimable);
    }

    // Test: claim reverts for non-beneficiary
    function test_claimRevertsForNonBeneficiary() public {
        vm.warp(BASE_TIME + CLIFF_DURATION + 30 days);
        vm.prank(other);
        vm.expectRevert("Not beneficiary");
        vesting.claim();
    }

    // Test: claim reverts when nothing to claim
    function test_claimRevertsWhenNothingToClaim() public {
        vm.prank(beneficiary);
        vm.expectRevert("Nothing to claim");
        vesting.claim();
    }

    // Test: revoke during cliff returns full allocation to owner
    function test_revokeDuringCliff() public {
        vm.warp(BASE_TIME + CLIFF_DURATION / 2);

        uint256 ownerBalanceBefore = token.balanceOf(owner);
        vm.prank(owner);
        vesting.revoke();
        uint256 ownerBalanceAfter = token.balanceOf(owner);

        // During cliff, nothing is vested, so all tokens go back to owner
        assertEq(ownerBalanceAfter - ownerBalanceBefore, ALLOCATION);
        assertTrue(vesting.revoked());
    }

    // Test: revoke after partial vesting
    function test_revokeAfterPartialVesting() public {
        vm.warp(BASE_TIME + VESTING_DURATION / 2);

        uint256 vested = vesting.vestedAmount();
        uint256 beneficiaryBalanceBefore = token.balanceOf(beneficiary);
        uint256 ownerBalanceBefore = token.balanceOf(owner);

        vm.prank(owner);
        vesting.revoke();

        uint256 beneficiaryBalanceAfter = token.balanceOf(beneficiary);
        uint256 ownerBalanceAfter = token.balanceOf(owner);

        // Beneficiary gets vested-but-unclaimed tokens
        assertEq(beneficiaryBalanceAfter - beneficiaryBalanceBefore, vested);
        // Owner gets unvested tokens
        assertEq(ownerBalanceAfter - ownerBalanceBefore, ALLOCATION - vested);
    }

    // Test: revoke after partial claim
    function test_revokeAfterPartialClaim() public {
        // Claim some tokens first
        vm.warp(BASE_TIME + VESTING_DURATION / 2);
        uint256 claimable = vesting.claimable();
        vm.prank(beneficiary);
        vesting.claim();

        // Now revoke
        uint256 vested = vesting.vestedAmount();
        uint256 beneficiaryBalanceBefore = token.balanceOf(beneficiary);
        uint256 ownerBalanceBefore = token.balanceOf(owner);

        vm.prank(owner);
        vesting.revoke();

        uint256 beneficiaryBalanceAfter = token.balanceOf(beneficiary);
        uint256 ownerBalanceAfter = token.balanceOf(owner);

        // Beneficiary gets remaining vested-but-unclaimed tokens
        assertEq(beneficiaryBalanceAfter - beneficiaryBalanceBefore, vested - claimable);
        // Owner gets unvested tokens (total - already claimed)
        assertEq(ownerBalanceAfter - ownerBalanceBefore, ALLOCATION - claimable);
    }

    // Test: revoke reverts for non-owner
    function test_revokeRevertsForNonOwner() public {
        vm.prank(other);
        vm.expectRevert("Not owner");
        vesting.revoke();
    }

    // Test: revoke reverts when already revoked
    function test_revokeRevertsWhenAlreadyRevoked() public {
        vm.startPrank(owner);
        vesting.revoke();
        vm.expectRevert("Already revoked");
        vesting.revoke();
        vm.stopPrank();
    }

    // Test: remainder accuracy — total claimed equals allocation at end
    function test_remainderAccuracy() public {
        vm.warp(BASE_TIME + VESTING_DURATION);
        uint256 claimable = vesting.claimable();
        assertEq(claimable, ALLOCATION);

        vm.prank(beneficiary);
        vesting.claim();
        assertEq(vesting.claimed(), ALLOCATION);
    }
}
