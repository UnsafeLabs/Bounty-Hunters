// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../../lib/openzeppelin-contracts/lib/forge-std/src/Test.sol";
import "../contracts/TokenVesting.sol";
import "../../../lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

contract MintableToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TokenVestingTest is Test {
    MintableToken public token;
    TokenVesting public vesting;

    address public owner = address(0x01);
    address public beneficiary = address(0x02);
    address public stranger = address(0x03);

    uint256 constant START_TIME = 1_000_000;
    uint256 constant CLIFF_DURATION = 100;
    uint256 constant VESTING_DURATION = 1000;

    function setUp() public {
        token = new MintableToken("Vesting Token", "VEST");
    }

    function _createVesting(uint256 allocation) internal returns (TokenVesting) {
        token.mint(address(this), allocation);
        token.approve(address(this), allocation);

        TokenVesting v = new TokenVesting(
            address(token),
            beneficiary,
            allocation,
            START_TIME,
            CLIFF_DURATION,
            VESTING_DURATION
        );

        // Fund the vesting contract
        token.transfer(address(v), allocation);
        return v;
    }

    // ==================== Overflow Prevention ====================

    function test_noOverflowWithMaxUint256Allocation() public {
        uint256 maxAllocation = type(uint256).max / 2 + 1; // Large enough to overflow with original formula
        vesting = _createVesting(maxAllocation);

        // Advance to middle of vesting period (past cliff)
        vm.warp(START_TIME + 500);

        // This should not overflow with the fixed formula
        uint256 vested = vesting.vestedAmount();
        emit log_named_uint("vested with large allocation", vested);

        assertGt(vested, 0, "Should have vested some tokens");
        assertLt(vested, maxAllocation, "Should not exceed total allocation");
    }

    function test_noOverflowNearUint256Max() public {
        // Use a value that would overflow in the original formula:
        // original: totalAllocation * elapsed / duration
        // With elapsed=500 and very large totalAllocation, this overflows
        uint256 largeAllocation = type(uint256).max / 100;
        vesting = _createVesting(largeAllocation);

        vm.warp(START_TIME + 500);

        uint256 vested = vesting.vestedAmount();
        emit log_named_uint("vested near uint256 max", vested);

        assertGt(vested, 0, "Should have vested tokens");
        // With divide-first: largeAllocation / 1000 * 500 = largeAllocation / 2
        uint256 expected = largeAllocation / 2;
        assertEq(vested, expected, "Should vest exactly half at midpoint");
    }

    function test_overflowPreventionExactCalculation() public {
        // Choose allocation that makes the math easy to verify
        // duration = 1000, elapsed = 500 => should get exactly 50%
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        vm.warp(START_TIME + 500);

        uint256 vested = vesting.vestedAmount();
        assertEq(vested, 500 ether, "Should vest exactly 50% at midpoint");
    }

    // ==================== Cliff Period Revocation ====================

    function test_cliffPeriodRevokeReturnsFullUnvested() public {
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        // During cliff period (before START_TIME + 100)
        vm.warp(START_TIME + 50);

        uint256 vested = vesting.vestedAmount();
        assertEq(vested, 0, "Nothing vested during cliff");

        vm.prank(owner);
        vesting.revoke();

        // Owner should receive all tokens back since nothing vested
        uint256 ownerBalance = token.balanceOf(owner);
        assertEq(ownerBalance, allocation, "Owner should receive full allocation back during cliff revoke");

        // Beneficiary should have nothing
        uint256 beneficiaryBalance = token.balanceOf(beneficiary);
        assertEq(beneficiaryBalance, 0, "Beneficiary should get nothing during cliff revoke");
    }

    function test_cliffPeriodRevokeAfterPartialClaim() public {
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        // First, let beneficiary claim after cliff ends
        vm.warp(START_TIME + 500);
        vm.prank(beneficiary);
        vesting.claim();

        uint256 claimedAmount = vesting.claimed();
        assertGt(claimedAmount, 0, "Should have claimed something");

        // Now test revoke in a new scenario during cliff with claimed > 0
        TokenVesting vesting2 = _createVesting(allocation);
        // Move past some vesting so vested > 0
        vm.warp(START_TIME + 500);
        vm.prank(beneficiary);
        vesting2.claim();

        uint256 claimed2 = vesting2.claimed();
        vm.prank(owner);
        vesting2.revoke();

        // Owner should get totalAllocation - vestedAmount (not totalAllocation - 0)
        uint256 ownerBalance = token.balanceOf(owner);
        uint256 expectedUnvested = allocation - vesting2.vestedAmount();
        assertEq(ownerBalance, expectedUnvested, "Owner should get correct unvested after partial vesting");
    }

    // ==================== Post-Cliff Revocation ====================

    function test_postCliffRevokeReturnsCorrectUnvested() public {
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        // After cliff, at 75% through vesting
        vm.warp(START_TIME + 750);
        uint256 vested = vesting.vestedAmount();
        assertEq(vested, 750 ether, "Should have vested 75%");

        vm.prank(owner);
        vesting.revoke();

        uint256 ownerBalance = token.balanceOf(owner);
        assertEq(ownerBalance, 250 ether, "Owner should get remaining 250 ether unvested");
    }

    function test_postCliffRevokeWithClaimedTokens() public {
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        // Move to midpoint
        vm.warp(START_TIME + 500);

        // Beneficiary claims
        vm.prank(beneficiary);
        vesting.claim();
        uint256 claimed = vesting.claimed();
        assertEq(claimed, 500 ether, "Should have claimed 500 ether");

        // Owner revokes
        vm.prank(owner);
        vesting.revoke();

        uint256 ownerBalance = token.balanceOf(owner);
        assertEq(ownerBalance, 500 ether, "Owner should get 500 ether unvested");
    }

    // ==================== Full Vesting Completion ====================

    function test_fullVestingAfterDuration() public {
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        // After full duration
        vm.warp(START_TIME + VESTING_DURATION + 1);

        uint256 vested = vesting.vestedAmount();
        assertEq(vested, allocation, "Should vest everything after duration");
    }

    function test_fullVestingExactEnd() public {
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        // Exactly at end
        vm.warp(START_TIME + VESTING_DURATION);

        uint256 vested = vesting.vestedAmount();
        assertEq(vested, allocation, "Should vest everything at exact end");
    }

    function test_claimAllAfterFullVesting() public {
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        vm.warp(START_TIME + VESTING_DURATION + 1);

        uint256 claimable = vesting.claimable();
        assertEq(claimable, allocation, "Should be able to claim everything");

        vm.prank(beneficiary);
        vesting.claim();

        assertEq(token.balanceOf(beneficiary), allocation, "Beneficiary should have all tokens");
    }

    // ==================== Remainder Accuracy ====================

    function test_remainderAccuracyNoTokensLost() public {
        // Use allocation not evenly divisible by duration to test remainder handling
        uint256 allocation = 1000 ether + 1; // 1 wei remainder when divided by 1000
        vesting = _createVesting(allocation);

        // At midpoint
        vm.warp(START_TIME + 500);

        uint256 vested = vesting.vestedAmount();
        // With fixed formula: (1000000000000000000001 / 1000) * 500 + (1000000000000000000001 % 1000) * 500 / 1000
        // = 1000000000000000000 * 500 + 1 * 500 / 1000
        // = 500000000000000000000 + 0
        // = 500000000000000000000
        emit log_named_uint("vested", vested);
        emit log_named_uint("half of allocation", allocation / 2);

        // The vested amount should be at least half (truncated)
        assertGe(vested, allocation / 2, "Should vest at least half");
        assertLe(vested, allocation, "Should not exceed total allocation");
    }

    function test_remainderAccumulatesToProperValue() public {
        // Allocation = 1001, duration = 1000 => per-period = 1, remainder = 1
        // At elapsed = 1000 (full): baseVested = (1001/1000)*1000 = 1*1000 = 1000
        // remainderVested = (1001%1000)*1000/1000 = 1*1000/1000 = 1
        // Total = 1001 = allocation (exact)
        uint256 allocation = 1001;
        vesting = _createVesting(allocation);

        vm.warp(START_TIME + VESTING_DURATION);

        uint256 vested = vesting.vestedAmount();
        assertEq(vested, allocation, "Remainder should be preserved at end of vesting");
    }

    function test_nothingVestedBeforeCliff() public {
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        // Just before cliff ends
        vm.warp(START_TIME + CLIFF_DURATION - 1);

        uint256 vested = vesting.vestedAmount();
        assertEq(vested, 0, "Nothing vested before cliff ends");
    }

    function test_vestedExactlyAtCliff() public {
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        // Exactly at cliff time => block.timestamp >= cliff is true
        vm.warp(START_TIME + CLIFF_DURATION);

        uint256 vested = vesting.vestedAmount();
        // elapsed = CLIFF_DURATION = 100
        // baseVested = (1000e18 / 1000) * 100 = 1e18 * 100 = 100e18
        uint256 expected = (allocation / VESTING_DURATION) * CLIFF_DURATION;
        assertEq(vested, expected, "Should vest amount proportional to cliff time");
    }

    // ==================== Edge Cases ====================

    function test_revertNonOwnerRevoke() public {
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        vm.warp(START_TIME + 50);

        vm.prank(stranger);
        vm.expectRevert("Not owner");
        vesting.revoke();
    }

    function test_revertDoubleRevoke() public {
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        vm.warp(START_TIME + 50);

        vm.prank(owner);
        vesting.revoke();

        vm.prank(owner);
        vm.expectRevert("Already revoked");
        vesting.revoke();
    }

    function test_revertNonBeneficiaryClaim() public {
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        vm.warp(START_TIME + VESTING_DURATION + 1);

        vm.prank(stranger);
        vm.expectRevert("Not beneficiary");
        vesting.claim();
    }

    function test_revertZeroClaimable() public {
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        // During cliff, nothing to claim
        vm.warp(START_TIME + 50);

        vm.prank(beneficiary);
        vm.expectRevert("Nothing to claim");
        vesting.claim();
    }

    // ==================== Right-Left Operation Order ====================

    function test_operationOrderAffectsPrecision() public {
        // Test that divide-before-multiply gives correct results
        // allocation = 7, duration = 10, elapsed = 3
        // Original (wrong for overflow): 7 * 3 / 10 = 21 / 10 = 2
        // Fixed (divide first): 7 / 10 * 3 = 0 * 3 = 0 + (7 % 10) * 3 / 10 = 7 * 3 / 10 = 21 / 10 = 2
        uint256 allocation = 7;
        vesting = _createVesting(allocation);

        vm.warp(START_TIME + 3); // elapsed = 3, but cliff = 100 so vested = 0

        // Need to put it past cliff for non-zero vesting
        // Let's use a scenario where cliff = 0
        token.mint(address(this), 10);
        token.approve(address(this), 10);
        TokenVesting vesting2 = new TokenVesting(
            address(token),
            beneficiary,
            7,
            START_TIME,
            0, // no cliff
            10
        );
        token.transfer(address(vesting2), 7);

        vm.warp(START_TIME + 3);

        uint256 vested = vesting2.vestedAmount();
        assertEq(vested, 2, "Should get correct result with non-divisible values");
    }

    function test_multipleClaimsDuringVesting() public {
        uint256 allocation = 1000 ether;
        vesting = _createVesting(allocation);

        // First claim at 25%
        vm.warp(START_TIME + 250);
        vm.prank(beneficiary);
        vesting.claim();
        assertEq(vesting.claimed(), 250 ether, "Should have claimed 250 ether");

        // Second claim at 50%
        vm.warp(START_TIME + 500);
        vm.prank(beneficiary);
        vesting.claim();
        assertEq(vesting.claimed(), 500 ether, "Should have claimed 500 ether total");

        // Third claim at 100%
        vm.warp(START_TIME + 1000);
        vm.prank(beneficiary);
        vesting.claim();
        assertEq(vesting.claimed(), 1000 ether, "Should have claimed full allocation");
    }
}
