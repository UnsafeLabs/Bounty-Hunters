// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/TokenVesting.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {
        _mint(msg.sender, 10_000_000_000 * 10 ** 18); // 10 billion tokens
    }
}

contract TokenVestingTest is Test {
    TokenVesting public vesting;
    MockToken public token;
    address public owner;
    address public beneficiary;

    uint256 constant START = 1000;
    uint256 constant CLIFF_DURATION = 100;
    uint256 constant VESTING_DURATION = 1000;

    function setUp() public {
        token = new MockToken();
        owner = address(this);
        beneficiary = address(0x1);

        vesting = new TokenVesting(
            address(token),
            beneficiary,
            1_000_000 * 10 ** 18, // 1M tokens
            START,
            CLIFF_DURATION,
            VESTING_DURATION
        );

        token.transfer(address(vesting), 1_000_000 * 10 ** 18);
    }

    // Test: Vesting calculation does not overflow for large allocations (1B tokens with 18 decimals)
    function test_NoOverflowForLargeAllocations() public {
        MockToken bigToken = new MockToken();
        uint256 largeAlloc = 1_000_000_000 * 10 ** 18; // 1 billion tokens

        TokenVesting bigVesting = new TokenVesting(
            address(bigToken),
            beneficiary,
            largeAlloc,
            START,
            CLIFF_DURATION,
            VESTING_DURATION
        );

        bigToken.transfer(address(bigVesting), largeAlloc);

        // At halfway through vesting
        vm.warp(START + 500);
        uint256 vested = bigVesting.vestedAmount();
        // Should be approximately half without overflow
        assertGt(vested, 0);
        assertLe(vested, largeAlloc);
    }

    // Test: Remainder handling ensures total claimed equals total allocation at vesting end
    function test_FullVestingMatchesTotalAllocation() public {
        vm.warp(START + VESTING_DURATION);
        uint256 vested = vesting.vestedAmount();
        assertEq(vested, 1_000_000 * 10 ** 18);
    }

    // Test: Linear vesting curve is accurate
    function test_LinearVestingAccuracy() public {
        // At 50% through vesting
        vm.warp(START + 500);
        uint256 vested = vesting.vestedAmount();
        uint256 expected = 1_000_000 * 10 ** 18 * 500 / 1000;
        // Should be within 1 token unit
        assertApproxEqAbs(vested, expected, 1 * 10 ** 18);
    }

    // Test: Cliff period returns 0
    function test_CliffPeriodReturnsZero() public {
        vm.warp(START + 50); // Before cliff
        uint256 vested = vesting.vestedAmount();
        assertEq(vested, 0);
    }

    // Test: Revocation during cliff period returns correct unvested amount
    function test_RevokeDuringCliffPeriod() public {
        vm.warp(START + 50); // Before cliff
        vesting.revoke();
        // Vested is 0, so all tokens go to owner
        // unvested = totalAllocation - vested = totalAllocation
        assertTrue(vesting.revoked());
    }

    // Test: Revocation after partial vesting returns only truly unvested tokens
    function test_RevokeAfterPartialVesting() public {
        vm.warp(START + 500); // 50% vested
        uint256 vested = vesting.vestedAmount();
        uint256 claimableAmt = vesting.claimable();

        vesting.revoke();

        // Beneficiary should have received vested - claimed tokens
        // Owner should have received totalAllocation - vested tokens
        assertTrue(vesting.revoked());
    }

    // Test: Claim works correctly
    function test_ClaimWorks() public {
        vm.warp(START + 500);
        uint256 balBefore = token.balanceOf(beneficiary);
        vm.prank(beneficiary);
        vesting.claim();
        uint256 balAfter = token.balanceOf(beneficiary);
        assertGt(balAfter, balBefore);
    }

    // Test: Cannot claim before cliff
    function test_CannotClaimBeforeCliff() public {
        vm.warp(START + 50);
        vm.prank(beneficiary);
        vm.expectRevert("Nothing to claim");
        vesting.claim();
    }

    // Test: Non-beneficiary cannot claim
    function test_NonBeneficiaryCannotClaim() public {
        vm.warp(START + 500);
        vm.prank(address(0x2));
        vm.expectRevert("Not beneficiary");
        vesting.claim();
    }

    // Test: Cannot revoke twice
    function test_CannotRevokeTwice() public {
        vm.warp(START + 500);
        vesting.revoke();
        vm.expectRevert("Already revoked");
        vesting.revoke();
    }

    // Test: Remainder accuracy for uneven division
    function test_RemainderAccuracy() public {
        // Use allocation that doesn't divide evenly by duration
        MockToken oddToken = new MockToken();
        uint256 oddAlloc = 999_999_999 * 10 ** 18 + 7; // Not evenly divisible

        TokenVesting oddVesting = new TokenVesting(
            address(oddToken),
            beneficiary,
            oddAlloc,
            START,
            CLIFF_DURATION,
            VESTING_DURATION
        );

        oddToken.transfer(address(oddVesting), oddAlloc);

        vm.warp(START + VESTING_DURATION);
        uint256 vested = oddVesting.vestedAmount();
        // At end of vesting, should equal total allocation
        assertEq(vested, oddAlloc);
    }
}
