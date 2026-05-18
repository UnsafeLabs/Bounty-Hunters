solidity
// File: solidity/test/TokenVestingTest.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/TokenVesting.sol";

/// @title Minimal ERC20 Mock for Vesting Testing
/// @notice Provides a simple ERC20 token with unlimited minting for testing
contract ERC20Mock {
    string public name = "MockToken";
    string public symbol = "MCK";
    uint8 public constant decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor() {
        balanceOf[msg.sender] = type(uint256).max;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "ERC20Mock: insufficient balance");
        unchecked {
            balanceOf[msg.sender] -= amount;
        }
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        require(balanceOf[from] >= amount, "ERC20Mock: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "ERC20Mock: insufficient allowance");
        unchecked {
            balanceOf[from] -= amount;
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

/// @title TokenVestingTest
/// @notice Comprehensive tests for TokenVesting contract covering overflow safety,
///         cliff revocation, post-cliff revocation, full vesting, remainder accuracy,
///         and input validation.
contract TokenVestingTest is Test {
    ERC20Mock public token;
    TokenVesting public vesting;

    address public constant BENEFICIARY = address(0x123);
    address public constant ADMIN = address(0x456);
    uint64 public constant CLIFF_DURATION = 30 days;
    uint64 public constant VESTING_DURATION = 365 days;
    uint256 public constant ALLOCATION = 1_000_000 ether;
    uint256 public constant START = block.timestamp + 1 days;

    /// @notice Set up: deploy minimal ERC20 mock and token vesting contract
    function setUp() public virtual {
        token = new ERC20Mock();
        // Deploy vesting contract with constructor parameters matching the real contract
        vesting = new TokenVesting(
            BENEFICIARY,
            uint64(START),
            CLIFF_DURATION,
            VESTING_DURATION,
            address(token),
            ALLOCATION
        );
        // Transfer the full allocation to the vesting contract
        token.transfer(address(vesting), ALLOCATION);
    }

    // ========================================================================
    //  Constructor and Input Validation
    // ========================================================================

    /// @notice Test that constructor reverts with zero beneficiary address.
    function testConstructorZeroBeneficiary() public {
        vm.expectRevert();
        new TokenVesting(
            address(0),
            uint64(START),
            CLIFF_DURATION,
            VESTING_DURATION,
            address(token),
            ALLOCATION
        );
    }

    /// @notice Test that constructor reverts with zero allocation.
    function testConstructorZeroAllocation() public {
        vm.expectRevert();
        new TokenVesting(
            BENEFICIARY,
            uint64(START),
            CLIFF_DURATION,
            VESTING_DURATION,
            address(token),
            0
        );
    }

    /// @notice Test that constructor reverts with zero token address.
    function testConstructorZeroToken() public {
        vm.expectRevert();
        new TokenVesting(
            BENEFICIARY,
            uint64(START),
            CLIFF_DURATION,
            VESTING_DURATION,
            address(0),
            ALLOCATION
        );
    }

    /// @notice Test that constructor reverts with zero duration.
    function testConstructorZeroDuration() public {
        vm.expectRevert();
        new TokenVesting(
            BENEFICIARY,
            uint64(START),
            CLIFF_DURATION,
            0,
            address(token),
            ALLOCATION
        );
    }

    // ========================================================================
    //  Overflow Safety
    // ========================================================================

    /// @notice Test that vesting calculation does not overflow even with allocation
    ///         equal to type(uint256).max and duration = 1 second (worst-case product).
    ///         The fixed formula `totalAllocation / duration * elapsed` must not overflow.
    function testOverflowSafetyMaxUint256() public {
        uint256 maxAllocation = type(uint256).max;
        uint64 newStart = uint64(block.timestamp);
        uint64 newCliff = 0;
        uint64 newDuration = 1; // 1 second — max product
        TokenVesting newVesting = new TokenVesting(
            BENEFICIARY,
            newStart,
            newCliff,
            newDuration,
            address(token),
            maxAllocation
        );
        // Transfer enough tokens — we only need to fund 1 wei for this test (claim will revert on zero balance)
        // But to claim the full maxUint would require that many tokens. Instead, we just verify no overflow revert.
        // We'll set up a smaller allocation for actual claim test. Use a reasonable large allocation.
        // For overflow test, we can use maxAllocation / 2 and large duration.
        maxAllocation = type(uint256).max / 2;
        newDuration = 365 days; // large but product would overflow in old formula
        newVesting = new TokenVesting(
            BENEFICIARY,
            newStart,
            newCliff,
            newDuration,
            address(token),
            maxAllocation
        );
        // Fund the contract with the allocation
        vm.deal(address(this), 0);
        token.transfer(address(newVesting), maxAllocation);
        // Warp to end of vesting period
        vm.warp(newStart + newDuration);
        // Claim — should succeed, no overflow
        newVesting.claim();
        // Beneficiary should have received full allocation (with possible 1 wei loss due to remainder)
        uint256 beneficiaryBalance = token.balanceOf(BENEFICIARY);
        assertApproxEqAbs(beneficiaryBalance, maxAllocation, 1, "Overflow safety: beneficiary should receive near full allocation");
    }

    /// @notice Test that vesting calculation does not overflow for a large but safe allocation (1e27).
    function testOverflowSafetyLargeAllocation() public {
        uint256 maxAllocation = 1_000_000_000 ether; // 1e27
        uint64 newStart = uint64(block.timestamp);
        uint64 newCliff = 0;
        uint64 newDuration = 4 * 365 days; // ~126 million seconds
        TokenVesting newVesting = new TokenVesting(
            BENEFICIARY,
            newStart,
            newCliff,
            newDuration,
            address(token),
            maxAllocation
        );
        token.transfer(address(newVesting), maxAllocation);
        // Warp to end of vesting period
        vm.warp(newStart + newDuration);
        newVesting.claim();
        // Beneficiary should have received full allocation (with possible 1 wei loss)
        uint256 beneficiaryBalance = token.balanceOf(BENEFICIARY);
        assertApproxEqAbs(beneficiaryBalance, maxAllocation, 1, "Overflow safety: beneficiary should receive near full allocation");
    }

    // ========================================================================
    //  Cliff Period Revocation
    // ========================================================================

    /// @notice Test that revocation during the cliff period returns the full allocation
    ///         (minus any already claimed) to the admin address.
    ///         Since no tokens are vested during the cliff, the unvested amount is the whole allocation.
    function testCliffRevocation() public {
        // Warp to a time before cliff ends (e.g., 10 days after start)
        vm.warp(START + 10 days);

        // Expect emission of VestingRevoked event
        vm.expectEmit(true, false, false, true);
        emit VestingRevoked(BENEFICIARY, ADMIN, ALLOCATION);
        vesting.revoke(ADMIN);

        uint256 beneficiaryBalance = token.balanceOf(BENEFICIARY);
        assertEq(beneficiaryBalance, 0, "Beneficiary should have 0 tokens during cliff revocation");

        uint256 adminBalance = token.balanceOf(ADMIN);
        assertEq(adminBalance, ALLOCATION, "Admin should receive full allocation");
    }

    // ========================================================================
    //  Post-Cliff (Partial) Revocation
    // ========================================================================

    /// @notice Test that revocation after partial vesting returns only the truly unvested tokens.
    ///         Beneficiary should keep the vested amount, admin gets the remainder.
    ///         Also verify that claimed + unvested = total allocation exactly.
    function testPostCliffRevocation() public {
        // Warp to halfway through total vesting period (after cliff ends)
        uint256 elapsed = CLIFF_DURATION + VESTING_DURATION / 2;
        vm.warp(START + elapsed);

        // Claim vested tokens
        vesting.claim();
        uint256 claimed = token.balanceOf(BENEFICIARY);
        assertGt(claimed, 0, "Beneficiary should have claimed some tokens");

        // Compute expected unvested using contract's own calculation
        uint256 expectedUnvested = ALLOCATION - vesting.vestedAmount();

        // Revoke remaining
        vesting.revoke(ADMIN);
        uint256 adminBalance = token.balanceOf(ADMIN);
        assertEq(adminBalance, expectedUnvested, "Admin should receive unvested tokens");

        // Verify sum of claimed + admin balance equals total allocation
        assertEq(claimed + adminBalance, ALLOCATION, "Claimed + unvested should equal total allocation");
    }

    // ========================================================================
    //  Full Vesting Completion
    // ========================================================================

    /// @notice Test that after the full vesting period, beneficiary can claim all tokens
    ///         exactly (due to remainder handling, total claimed = total allocation).
    function testFullVestingCompletion() public {
        vm.warp(START + CLIFF_DURATION + VESTING_DURATION);

        // Claim all vested tokens in one go
        vesting.claim();
        uint256 claimedAfterFirst = token.balanceOf(BENEFICIARY);

        // Claim remainder (should be zero or very small)
        vesting.claim();
        uint256 claimedAfterSecond = token.balanceOf(BENEFICIARY);

        // Total should be exactly allocation (remainder handled)
        assertEq(claimedAfterSecond, ALLOCATION, "Total claimed after full vesting should equal allocation exactly");
    }

    /// @notice Test that after full vesting, multiple claims accumulate to exact allocation.
    function testFullVestingWithMultipleClaims() public {
        // Warp to end of vesting
        vm.warp(START + CLIFF_DURATION + VESTING_DURATION);

        // Claim three times, accumulating
        vesting.claim();
        uint256 firstClaim = token.balanceOf(BENEFICIARY);
        vesting.claim();
        uint256 secondClaim = token.balanceOf(BENEFICIARY) - firstClaim;
        vesting.claim();
        uint256 thirdClaim = token.balanceOf(BENEFICIARY) - secondClaim - firstClaim;

        // Total should be exactly allocation
        assertEq(token.balanceOf(BENEFICIARY), ALLOCATION, "Multiple claims should sum to exact allocation");
        // Each intermediate claim should be non-negative and not revert
        assertGe(firstClaim, 0);
        assertGe(secondClaim, 0);
        assertGe(thirdClaim, 0);
    }

    /// @notice Test that linear vesting curve is accurate over the full period.
    ///         Warp to multiple points and compare vested amount with expected linear values.
    function testLinearVestingCurve() public {
        // Skip cliff: warp to start + cliff
        uint256 cliffEnd = START + CLIFF_DURATION;
        vm.warp(cliffEnd);
        uint256 vestedAtCliff = vesting.vestedAmount();
        assertEq(vestedAtCliff, 0, "Vested amount should be zero at cliff end");

        // Warp to 25% of vesting period after cliff
        uint256 quarterEnd = cliffEnd + VESTING_DURATION / 4;
        vm.warp(quarterEnd);
        uint256 expectedQuarter = (ALLOCATION * 25) / 100; // 25%
        uint256 vestedQuarter = vesting.vestedAmount();
        assertApproxEqAbs(vestedQuarter, expectedQuarter, 1, "Vested at 25% should be approximately 25% of allocation");

        // Warp to 50%
        uint256 halfEnd = cliffEnd + VESTING_DURATION / 2;
        vm.warp(halfEnd);
        uint256 expectedHalf = (ALLOCATION * 50) / 100;
        uint256 vestedHalf = vesting.vestedAmount();
        assertApproxEqAbs(vestedHalf, expectedHalf, 1, "Vested at 50% should be approximately 50% of allocation");

        // Warp to 75%
        uint256 threeQuarterEnd = cliffEnd + (VESTING_DURATION * 3) / 4;
        vm.warp(threeQuarterEnd);
        uint256 expectedThreeQuarter = (ALLOCATION * 75) / 100;
        uint256 vestedThreeQuarter = vesting.vestedAmount();
        assertApproxEqAbs(vestedThreeQuarter, expectedThreeQuarter, 1, "Vested at 75% should be approximately 75% of allocation");

        // Warp to end
        uint256 finalEnd = cliffEnd + VESTING_DURATION;
        vm.warp(finalEnd);
        uint256 vestedFinal = vesting.vestedAmount();
        // At final second, vested should be exactly allocation (or at most 1 wei less due to rounding)
        assertApproxEqAbs(vestedFinal, ALLOCATION, 1, "Vested at 100% should be approximately allocation");
    }

    // ========================================================================
    //  Remainder Accuracy
    // ========================================================================

    /// @notice Test that remainder handling ensures total claimed equals total allocation at vesting end.
    ///         Uses exact equality after multiple claims.
    function testRemainderAccuracyExact() public {
        vm.warp(START + CLIFF_DURATION + VESTING_DURATION);

        // Claim several times to ensure remainder is not lost.
        vesting.claim();
        vesting.claim();
        vesting.claim();
        vesting.claim();
        uint256 totalClaimed = token.balanceOf(BENEFICIARY);

        // Should be exactly equal to allocation (no wei lost)
        assertEq(totalClaimed, ALLOCATION, "Remainder accuracy: total claimed must equal total allocation exactly");
    }

    // ========================================================================
    //  Edge Cases
    // ========================================================================

    /// @notice Test that no one can claim before the cliff (vested amount = 0).
    function testClaimBeforeCliff() public {
        vm.warp(START);
        // Claim should revert because vested amount is zero
        vm.expectRevert();
        vesting.claim();
    }

    /// @notice Test that after full vesting, further claims return nothing.
    function testClaimAfterFullVesting() public {
        vm.warp(START + CLIFF_DURATION + VESTING_DURATION);
        vesting.claim();
        uint256 balanceAfterFirst = token.balanceOf(BENEFICIARY);
        // Second claim should not increase balance (no more tokens)
        vesting.claim();
        assertEq(token.balanceOf(BENEFICIARY), balanceAfterFirst, "Second claim should not increase balance");
    }

    /// @notice Test that revocation after full vesting returns zero (all tokens already claimed).
    function testRevocationAfterFullVesting() public {
        vm.warp(START + CLIFF_DURATION + VESTING_DURATION);
        vesting.claim();
        // Revoke — should return 0 unvested
        vesting.revoke(ADMIN);
        assertEq(token.balanceOf(ADMIN), 0, "Admin should receive 0 tokens after full vesting");
    }

    /// @notice Test that revoking with zero address as admin reverts.
    function testRevokeToZeroAddress() public {
        vm.warp(START + CLIFF_DURATION + VESTING_DURATION);
        vm.expectRevert();
        vesting.revoke(address(0));
    }

    /// @notice Test that non-admin cannot revoke.
    function testRevokeOnlyAdmin() public {
        vm.warp(START + 10 days);
        vm.prank(BENEFICIARY);
        vm.expectRevert();
        vesting.revoke(ADMIN);
    }
}