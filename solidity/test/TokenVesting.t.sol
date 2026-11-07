// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/TokenVesting.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol, uint256 initialSupply) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }
}

contract TokenVestingTest is Test {
    TokenVesting public vesting;
    MockToken public token;
    address public owner;
    address public beneficiary;
    address public other;

    uint256 public constant TOTAL_ALLOCATION = 1000000 * 1e18;
    uint256 public constant START_TIME = 1000000;
    uint256 public constant CLIFF_DURATION = 180 days;
    uint256 public constant VESTING_DURATION = 365 days;

    function setUp() public {
        owner = address(this);
        beneficiary = makeAddr("beneficiary");
        other = makeAddr("other");

        token = new MockToken("Test Token", "TST", 10000000 * 1e18);
        
        vesting = new TokenVesting(
            address(token),
            beneficiary,
            TOTAL_ALLOCATION,
            START_TIME,
            CLIFF_DURATION,
            VESTING_DURATION
        );

        // Fund vesting contract
        token.transfer(address(vesting), TOTAL_ALLOCATION);
    }

    function test_InitialState() public view {
        assertEq(vesting.token(), address(token));
        assertEq(vesting.beneficiary(), beneficiary);
        assertEq(vesting.owner(), owner);
        assertEq(vesting.totalAllocation(), TOTAL_ALLOCATION);
        assertEq(vesting.start(), START_TIME);
        assertEq(vesting.cliff(), START_TIME + CLIFF_DURATION);
        assertEq(vesting.duration(), VESTING_DURATION);
        assertEq(vesting.claimed(), 0);
        assertFalse(vesting.revoked());
    }

    function test_VestedAmountBeforeCliff() public {
        vm.warp(START_TIME + 90 days); // Before cliff
        assertEq(vesting.vestedAmount(), 0);
    }

    function test_VestedAmountAtCliff() public {
        vm.warp(START_TIME + CLIFF_DURATION); // At cliff
        uint256 expected = TOTAL_ALLOCATION * CLIFF_DURATION / VESTING_DURATION;
        assertEq(vesting.vestedAmount(), expected);
    }

    function test_VestedAmountMidVesting() public {
        vm.warp(START_TIME + CLIFF_DURATION + 90 days); // Mid vesting
        uint256 elapsed = CLIFF_DURATION + 90 days;
        uint256 expected = TOTAL_ALLOCATION * elapsed / VESTING_DURATION;
        assertEq(vesting.vestedAmount(), expected);
    }

    function test_VestedAmountAfterVesting() public {
        vm.warp(START_TIME + VESTING_DURATION + 1); // After full vesting
        assertEq(vesting.vestedAmount(), TOTAL_ALLOCATION);
    }

    function test_NoOverflowForLargeAllocation() public {
        // Test with 1 billion tokens (1e27 with 18 decimals)
        uint256 largeAllocation = 1000000000 * 1e18;
        
        TokenVesting largeVesting = new TokenVesting(
            address(token),
            beneficiary,
            largeAllocation,
            START_TIME,
            CLIFF_DURATION,
            VESTING_DURATION
        );

        vm.warp(START_TIME + CLIFF_DURATION + 180 days);
        
        // Should not overflow
        uint256 vested = largeVesting.vestedAmount();
        assertGt(vested, 0);
        assertLt(vested, largeAllocation);
    }

    function test_ClaimableBeforeCliff() public {
        vm.warp(START_TIME + 90 days);
        assertEq(vesting.claimable(), 0);
    }

    function test_ClaimableAfterCliff() public {
        vm.warp(START_TIME + CLIFF_DURATION);
        uint256 claimable = vesting.claimable();
        assertGt(claimable, 0);
    }

    function test_Claim() public {
        vm.warp(START_TIME + CLIFF_DURATION + 90 days);
        
        uint256 claimable = vesting.claimable();
        uint256 balBefore = token.balanceOf(beneficiary);

        vm.prank(beneficiary);
        vesting.claim();

        uint256 balAfter = token.balanceOf(beneficiary);
        assertEq(balAfter - balBefore, claimable);
        assertEq(vesting.claimed(), claimable);
    }

    function test_ClaimNotBeneficiary() public {
        vm.warp(START_TIME + CLIFF_DURATION);
        
        vm.prank(other);
        vm.expectRevert("Not beneficiary");
        vesting.claim();
    }

    function test_ClaimNothingToClaim() public {
        vm.warp(START_TIME + 90 days); // Before cliff
        
        vm.prank(beneficiary);
        vm.expectRevert("Nothing to claim");
        vesting.claim();
    }

    function test_MultipleClaims() public {
        vm.warp(START_TIME + CLIFF_DURATION);
        
        vm.prank(beneficiary);
        vesting.claim();
        uint256 claimed1 = vesting.claimed();

        vm.warp(START_TIME + CLIFF_DURATION + 90 days);
        
        vm.prank(beneficiary);
        vesting.claim();
        uint256 claimed2 = vesting.claimed();

        assertGt(claimed2, claimed1);
    }

    function test_RevokeDuringCliff() public {
        vm.warp(START_TIME + 90 days); // During cliff
        
        uint256 ownerBalBefore = token.balanceOf(owner);
        
        vesting.revoke();
        
        assertTrue(vesting.revoked());
        assertEq(vesting.claimed(), 0);
        
        // Owner should receive all tokens (nothing vested)
        uint256 ownerBalAfter = token.balanceOf(owner);
        assertEq(ownerBalAfter - ownerBalBefore, TOTAL_ALLOCATION);
    }

    function test_RevokeAfterPartialVesting() public {
        vm.warp(START_TIME + CLIFF_DURATION + 90 days);
        
        uint256 vested = vesting.vestedAmount();
        uint256 unvested = TOTAL_ALLOCATION - vested;
        
        uint256 ownerBalBefore = token.balanceOf(owner);
        uint256 beneficiaryBalBefore = token.balanceOf(beneficiary);
        
        vesting.revoke();
        
        assertTrue(vesting.revoked());
        
        // Beneficiary should receive vested amount
        uint256 beneficiaryBalAfter = token.balanceOf(beneficiary);
        assertEq(beneficiaryBalAfter - beneficiaryBalBefore, vested);
        
        // Owner should receive unvested amount
        uint256 ownerBalAfter = token.balanceOf(owner);
        assertEq(ownerBalAfter - ownerBalBefore, unvested);
        
        // Total should equal allocation
        assertEq(vested + unvested, TOTAL_ALLOCATION);
    }

    function test_RevokeAfterFullVesting() public {
        vm.warp(START_TIME + VESTING_DURATION + 1);
        
        uint256 ownerBalBefore = token.balanceOf(owner);
        uint256 beneficiaryBalBefore = token.balanceOf(beneficiary);
        
        vesting.revoke();
        
        assertTrue(vesting.revoked());
        
        // Beneficiary should receive all tokens
        uint256 beneficiaryBalAfter = token.balanceOf(beneficiary);
        assertEq(beneficiaryBalAfter - beneficiaryBalBefore, TOTAL_ALLOCATION);
        
        // Owner should receive nothing
        uint256 ownerBalAfter = token.balanceOf(owner);
        assertEq(ownerBalAfter - ownerBalBefore, 0);
    }

    function test_RevokeNotOwner() public {
        vm.prank(other);
        vm.expectRevert("Not owner");
        vesting.revoke();
    }

    function test_RevokeTwice() public {
        vesting.revoke();
        
        vm.expectRevert("Already revoked");
        vesting.revoke();
    }

    function test_RevokeAfterClaim() public {
        vm.warp(START_TIME + CLIFF_DURATION + 90 days);
        
        vm.prank(beneficiary);
        vesting.claim();
        uint256 claimed = vesting.claimed();
        
        uint256 vested = vesting.vestedAmount();
        uint256 unvested = TOTAL_ALLOCATION - vested;
        
        uint256 ownerBalBefore = token.balanceOf(owner);
        uint256 beneficiaryBalBefore = token.balanceOf(beneficiary);
        
        vesting.revoke();
        
        // Beneficiary should receive remaining vested (vested - claimed)
        uint256 beneficiaryBalAfter = token.balanceOf(beneficiary);
        assertEq(beneficiaryBalAfter - beneficiaryBalBefore, vested - claimed);
        
        // Owner should receive unvested
        uint256 ownerBalAfter = token.balanceOf(owner);
        assertEq(ownerBalAfter - ownerBalBefore, unvested);
    }

    function test_RemainderAccuracy() public {
        // Test that remainder handling is accurate
        vm.warp(START_TIME + VESTING_DURATION);
        
        uint256 vested = vesting.vestedAmount();
        
        // Should be very close to total allocation (< 1 token unit error)
        uint256 error = TOTAL_ALLOCATION > vested ? TOTAL_ALLOCATION - vested : vested - TOTAL_ALLOCATION;
        assertLt(error, 1e18); // < 1 token
    }

    function test_FullVestingCompletion() public {
        // Simulate full vesting period with multiple claims
        uint256 totalClaimed = 0;
        
        // Claim at cliff
        vm.warp(START_TIME + CLIFF_DURATION);
        vm.prank(beneficiary);
        vesting.claim();
        totalClaimed += vesting.claimed();
        
        // Claim at midpoint
        vm.warp(START_TIME + CLIFF_DURATION + 90 days);
        vm.prank(beneficiary);
        vesting.claim();
        totalClaimed = vesting.claimed();
        
        // Claim at end
        vm.warp(START_TIME + VESTING_DURATION);
        vm.prank(beneficiary);
        vesting.claim();
        totalClaimed = vesting.claimed();
        
        // Total claimed should equal allocation (< 1 token error)
        uint256 error = TOTAL_ALLOCATION > totalClaimed ? TOTAL_ALLOCATION - totalClaimed : totalClaimed - TOTAL_ALLOCATION;
        assertLt(error, 1e18);
    }

    function test_InvalidTokenAddress() public {
        vm.expectRevert("Invalid token");
        new TokenVesting(address(0), beneficiary, TOTAL_ALLOCATION, START_TIME, CLIFF_DURATION, VESTING_DURATION);
    }

    function test_InvalidBeneficiaryAddress() public {
        vm.expectRevert("Invalid beneficiary");
        new TokenVesting(address(token), address(0), TOTAL_ALLOCATION, START_TIME, CLIFF_DURATION, VESTING_DURATION);
    }

    function test_ZeroAllocation() public {
        vm.expectRevert("Allocation must be > 0");
        new TokenVesting(address(token), beneficiary, 0, START_TIME, CLIFF_DURATION, VESTING_DURATION);
    }

    function test_ZeroDuration() public {
        vm.expectRevert("Duration must be > 0");
        new TokenVesting(address(token), beneficiary, TOTAL_ALLOCATION, START_TIME, CLIFF_DURATION, 0);
    }

    function test_CliffGreaterThanDuration() public {
        vm.expectRevert("Cliff > duration");
        new TokenVesting(address(token), beneficiary, TOTAL_ALLOCATION, START_TIME, VESTING_DURATION + 1, VESTING_DURATION);
    }
}
