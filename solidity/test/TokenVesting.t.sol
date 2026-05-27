// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/TokenVesting.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MCK") {
        _mint(msg.sender, 1_000_000_000 * 10 ** decimals());
    }
}

contract TokenVestingTest is Test {
    TokenVesting vesting;
    MockERC20 token;
    address owner;
    address beneficiary;
    uint256 constant TOTAL = 1_000_000_000 * 10 ** 18; // 1 billion with 18 decimals
    uint256 constant START = 1000;
    uint256 constant CLIFF = 500;
    uint256 constant DURATION = 10000;

    function setUp() public {
        owner = address(this);
        beneficiary = address(0x1);
        token = new MockERC20();
        vesting = new TokenVesting(
            address(token),
            beneficiary,
            TOTAL,
            START,
            CLIFF,
            DURATION
        );
        token.transfer(address(vesting), TOTAL);
    }

    // ─── Overflow Prevention ───

    function test_noOverflowForMaxAllocation() public {
        // 1 billion tokens with 18 decimals
        // With divide-before-multiply, intermediate values stay within uint256
        vm.warp(START + DURATION / 2);
        uint256 vested = vesting.vestedAmount();
        assertLe(vested, TOTAL);
    }

    function test_vestingCalculationAccuracy() public {
        // At exactly half duration, vested should be ~half
        vm.warp(START + DURATION / 2);
        uint256 vested = vesting.vestedAmount();
        uint256 expected = TOTAL / 2;
        // Allow 1 token unit tolerance
        assertApproxEqAbs(vested, expected, 1 * 10 ** 18);
    }

    function test_fullVestingCompletion() public {
        vm.warp(START + DURATION);
        uint256 vested = vesting.vestedAmount();
        assertEq(vested, TOTAL);
    }

    function test_remainderAccuracy() public {
        // Use allocation that doesn't divide evenly by duration
        // TOTAL=1e27, DURATION=10000 → remainder = 1e27 % 10000
        vm.warp(START + DURATION);
        assertEq(vesting.vestedAmount(), TOTAL);

        // Check at an arbitrary point
        vm.warp(START + 3333);
        uint256 vested = vesting.vestedAmount();
        // Verify: vested <= TOTAL (no overflow)
        assertLe(vested, TOTAL);
        // Verify: vested is proportional (within 1 token)
        uint256 expected = (TOTAL / DURATION) * 3333 + (TOTAL % DURATION) * 3333 / DURATION;
        assertApproxEqAbs(vested, expected, 1);
    }

    // ─── Cliff Period ───

    function test_noVestingBeforeCliff() public {
        vm.warp(START + CLIFF - 1);
        assertEq(vesting.vestedAmount(), 0);
    }

    function test_vestingAfterCliff() public {
        vm.warp(START + CLIFF);
        assertGt(vesting.vestedAmount(), 0);
    }

    // ─── Revocation During Cliff ───

    function test_revokeDuringCliff() public {
        vm.warp(START + CLIFF / 2);
        // During cliff, vested = 0, claimed = 0
        // Unvested should be totalAllocation - claimed - (vested - claimed) = totalAllocation
        uint256 balBeforeBeneficiary = token.balanceOf(beneficiary);
        uint256 balBeforeOwner = token.balanceOf(owner);

        vesting.revoke();

        // Beneficiary gets nothing (vested=0, claimed=0, so vested-claimed=0)
        assertEq(token.balanceOf(beneficiary), balBeforeBeneficiary);
        // Owner gets all tokens back
        assertEq(token.balanceOf(owner) - balBeforeOwner, TOTAL);
        // Unvested = TOTAL since nothing was vested or claimed
    }

    // ─── Revocation After Partial Vesting ───

    function test_revokeAfterPartialVesting() public {
        vm.warp(START + CLIFF + 1000);
        uint256 vested = vesting.vestedAmount();
        assertGt(vested, 0);
        assertLt(vested, TOTAL);

        uint256 balBeforeOwner = token.balanceOf(owner);
        vesting.revoke();

        // Owner gets unvested = totalAllocation - vested
        uint256 ownerReceived = token.balanceOf(owner) - balBeforeOwner;
        assertEq(ownerReceived, TOTAL - vested);
        // Beneficiary gets vested (not yet claimed)
        assertEq(token.balanceOf(beneficiary), vested);
    }

    // ─── Revocation After Some Claims ───

    function test_revokeAfterClaim() public {
        vm.warp(START + CLIFF + 2000);
        uint256 vestedBefore = vesting.vestedAmount();

        // Beneficiary claims
        vm.prank(beneficiary);
        vesting.claim();
        uint256 claimed = vestedBefore; // claimed = vestedAmount since first claim

        // Now revoke
        uint256 balBeforeOwner = token.balanceOf(owner);
        vesting.revoke();

        // Owner gets totalAllocation - claimed
        uint256 ownerReceived = token.balanceOf(owner) - balBeforeOwner;
        assertEq(ownerReceived, TOTAL - claimed);
    }

    // ─── Claim ───

    function test_claim() public {
        vm.warp(START + CLIFF + 1000);
        uint256 vested = vesting.vestedAmount();

        vm.prank(beneficiary);
        vesting.claim();

        assertEq(token.balanceOf(beneficiary), vested);
        assertEq(vesting.claimed(), vested);
    }

    function test_cannotClaimBeforeCliff() public {
        vm.warp(START + CLIFF / 2);
        vm.prank(beneficiary);
        vm.expectRevert("Nothing to claim");
        vesting.claim();
    }

    function test_onlyBeneficiaryCanClaim() public {
        vm.warp(START + CLIFF + 1000);
        vm.prank(address(0x2));
        vm.expectRevert("Not beneficiary");
        vesting.claim();
    }

    // ─── Edge Cases ───

    function test_doubleRevertReverts() public {
        vm.warp(START + CLIFF + 1000);
        vesting.revoke();
        vm.expectRevert("Already revoked");
        vesting.revoke();
    }

    function test_onlyOwnerCanRevoke() public {
        vm.warp(START + CLIFF + 1000);
        vm.prank(address(0x2));
        vm.expectRevert("Not owner");
        vesting.revoke();
    }

    function test_linearVestingCurveAccuracy() public {
        // Check at multiple points that vesting follows linear curve
        for (uint256 t = START + CLIFF; t <= START + DURATION; t += 1000) {
            vm.warp(t);
            uint256 elapsed = t - START;
            uint256 expected = (TOTAL / DURATION) * elapsed + (TOTAL % DURATION) * elapsed / DURATION;
            uint256 actual = vesting.vestedAmount();
            assertApproxEqAbs(actual, expected, 1);
        }
    }
}
