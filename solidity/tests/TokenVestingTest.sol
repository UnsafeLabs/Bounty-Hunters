// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/TokenVesting.sol";
import "../mocks/MockERC20.sol";

/// @title TokenVestingTest - Foundry tests for TokenVesting overflow fix (issue #917)
/// @notice Run with: forge test --match-contract TokenVestingTest -vvv
contract TokenVestingTest {
    MockERC20 public token;
    TokenVesting public vesting;

    address public owner = address(this);
    address public beneficiary = address(0xBEEF);
    address public other = address(0xCAFE);

    // 1 billion tokens with 18 decimals — the max allocation that must not overflow
    uint256 constant MAX_ALLOCATION = 1_000_000_000 * 1e18;
    uint256 constant ONE_YEAR = 365 days;
    uint256 constant SIX_MONTHS = 182 days;
    uint256 constant ONE_DAY = 1 days;

    event TokensClaimed(address indexed beneficiary, uint256 amount);
    event VestingRevoked(address indexed beneficiary, uint256 unvested);

    function setUp() public {
        token = new MockERC20("TestToken", "TT", 18);
    }

    /// Helper: deploy a fresh vesting contract with given params
    function _deployVesting(
        uint256 totalAlloc,
        uint256 cliffDuration,
        uint256 vestDuration
    ) internal returns (TokenVesting) {
        TokenVesting v = new TokenVesting(
            address(token),
            beneficiary,
            totalAlloc,
            block.timestamp,
            cliffDuration,
            vestDuration
        );
        // Fund the vesting contract
        token.mint(address(v), totalAlloc);
        return v;
    }

    // =========================================
    // Test: Maximum allocation does NOT overflow
    // Issue #917 core requirement
    // =========================================
    function test_vestedAmount_maxAllocation_noOverflow() public {
        vesting = _deployVesting(MAX_ALLOCATION, SIX_MONTHS, ONE_YEAR);

        // Warp to mid-vesting: elapsed = 9 months
        vm.warp(block.timestamp + 9 * ONE_YEAR / 12);

        uint256 vested = vesting.vestedAmount();
        // Should be ~75% of MAX_ALLOCATION
        assert(vested > 0, "Vested should be > 0");
        assert(vested <= MAX_ALLOCATION, "Vested should not exceed allocation");
    }

    // =========================================
    // Test: Full vesting completion - all tokens accounted for
    // =========================================
    function test_vestedAmount_fullVestingCompletion() public {
        vesting = _deployVesting(MAX_ALLOCATION, 0, ONE_YEAR);

        vm.warp(block.timestamp + ONE_YEAR + 1);
        uint256 vested = vesting.vestedAmount();
        assert(vested == MAX_ALLOCATION, "Full period should vest entire allocation");
    }

    // =========================================
    // Test: Remainder accuracy — total claimed equals total allocation at end
    // =========================================
    function test_claim_fullVesting_noLostTokens() public {
        uint256 alloc = 1000 * 1e18;
        vesting = _deployVesting(alloc, 0, ONE_YEAR);

        // Claim at 1/3
        vm.warp(block.timestamp + ONE_YEAR / 3);
        uint256 c1 = vesting.claimable();
        vesting.claim();

        // Claim at 2/3
        vm.warp(block.timestamp + ONE_YEAR / 3);
        uint256 c2 = vesting.claimable();
        vesting.claim();

        // Claim at end
        vm.warp(block.timestamp + ONE_YEAR / 3 + 1);
        uint256 c3 = vesting.claimable();
        vesting.claim();

        uint256 totalClaimed = c1 + c2 + c3;
        // Allow rounding loss of at most 1 wei per claim interval
        assert(totalClaimed >= alloc - 3, "Lost more than 3 wei over full period");
        assert(totalClaimed <= alloc, "Claimed more than allocation");
    }

    // =========================================
    // Test: Remainder accuracy for MAX_ALLOCATION
    // =========================================
    function test_remainderAccuracy_maxAllocation() public {
        vesting = _deployVesting(MAX_ALLOCATION, 0, ONE_YEAR);

        // Warp to one second before end
        vm.warp(block.timestamp + ONE_YEAR - 1);
        uint256 almostVested = vesting.vestedAmount();

        // Warp to end
        vm.warp(block.timestamp + 1);
        uint256 fullVested = vesting.vestedAmount();

        assert(fullVested == MAX_ALLOCATION, "At end, vested should equal total allocation");
        // The last second should not lose more than 1 wei
        assert(fullVested - almostVested >= (MAX_ALLOCATION / ONE_YEAR) - 1, "Last-second vesting inaccurate");
    }

    // =========================================
    // Test: Cliff period — no tokens vested before cliff
    // =========================================
    function test_cliffPeriod_zeroVested() public {
        vesting = _deployVesting(MAX_ALLOCATION, SIX_MONTHS, ONE_YEAR);

        // Before cliff
        vm.warp(block.timestamp + SIX_MONTHS - 1);
        assert(vesting.vestedAmount() == 0, "Should be 0 before cliff");
        assert(vesting.claimable() == 0, "Should be 0 claimable before cliff");

        // At cliff
        vm.warp(block.timestamp + 1);
        assert(vesting.vestedAmount() > 0, "Should vest after cliff");
    }

    // =========================================
    // Test: Cliff period revocation — owner gets all tokens back
    // =========================================
    function test_revoke_duringCliff() public {
        uint256 alloc = 1000 * 1e18;
        vesting = _deployVesting(alloc, SIX_MONTHS, ONE_YEAR);

        uint256 ownerBalBefore = token.balanceOf(owner);
        uint256 benefBalBefore = token.balanceOf(beneficiary);

        // Revoke during cliff
        vesting.revoke();

        uint256 ownerBalAfter = token.balanceOf(owner);
        uint256 benefBalAfter = token.balanceOf(beneficiary);

        // During cliff: vested = 0, so unvested = alloc
        // Owner should get everything back
        assert(ownerBalAfter - ownerBalBefore == alloc, "Owner should get all tokens during cliff revoke");
        assert(benefBalAfter - benefBalBefore == 0, "Beneficiary should get nothing during cliff revoke");
        assert(vesting.revoked(), "Should be marked as revoked");
    }

    // =========================================
    // Test: Post-cliff partial vesting revocation
    // =========================================
    function test_revoke_afterPartialVesting() public {
        uint256 alloc = 1000 * 1e18;
        vesting = _deployVesting(alloc, 0, ONE_YEAR);

        // Warp to 50% vesting
        vm.warp(block.timestamp + ONE_YEAR / 2);
        uint256 vested50 = vesting.vestedAmount();

        uint256 ownerBalBefore = token.balanceOf(owner);
        uint256 benefBalBefore = token.balanceOf(beneficiary);

        vesting.revoke();

        uint256 ownerBalAfter = token.balanceOf(owner);
        uint256 benefBalAfter = token.balanceOf(beneficiary);

        uint256 unvested = alloc - vested50;

        // Beneficiary gets vested-but-unclaimed tokens
        assert(benefBalAfter - benefBalBefore == vested50, "Beneficiary should get vested tokens");
        // Owner gets unvested tokens
        assert(ownerBalAfter - ownerBalBefore == unvested, "Owner should get unvested tokens");
    }

    // =========================================
    // Test: Post-cliff revocation with partial claims
    // =========================================
    function test_revoke_afterPartialClaim() public {
        uint256 alloc = 1000 * 1e18;
        vesting = _deployVesting(alloc, 0, ONE_YEAR);

        // Warp to 50% and claim
        vm.warp(block.timestamp + ONE_YEAR / 2);
        uint256 vested50 = vesting.vestedAmount();
        vesting.claim();  // claim vested50 tokens

        uint256 ownerBalBefore = token.balanceOf(owner);
        uint256 benefBalBefore = token.balanceOf(beneficiary);

        vesting.revoke();

        uint256 ownerBalAfter = token.balanceOf(owner);
        uint256 benefBalAfter = token.balanceOf(beneficiary);

        uint256 unvested = alloc - vested50;

        // Beneficiary already claimed vested50, so gets 0 more
        assert(benefBalAfter - benefBalBefore == 0, "Beneficiary should get nothing more after claim");
        // Owner gets unvested
        assert(ownerBalAfter - ownerBalBefore == unvested, "Owner should get unvested tokens");
    }

    // =========================================
    // Test: Revoke at end of vesting — owner gets nothing, beneficiary gets remainder
    // =========================================
    function test_revoke_atVestingEnd() public {
        uint256 alloc = 1000 * 1e18;
        vesting = _deployVesting(alloc, 0, ONE_YEAR);

        vm.warp(block.timestamp + ONE_YEAR + 1);

        uint256 ownerBalBefore = token.balanceOf(owner);
        uint256 benefBalBefore = token.balanceOf(beneficiary);

        vesting.revoke();

        uint256 ownerBalAfter = token.balanceOf(owner);
        uint256 benefBalAfter = token.balanceOf(beneficiary);

        // All vested, unvested = 0
        assert(ownerBalAfter - ownerBalBefore == 0, "Owner should get nothing at end");
        assert(benefBalAfter - benefBalBefore == alloc, "Beneficiary should get all remaining");
    }

    // =========================================
    // Test: Overflow scenario — large allocation at various timestamps
    // =========================================
    function test_vestedAmount_largeAlloc_variousTimestamps() public {
        vesting = _deployVesting(MAX_ALLOCATION, 0, ONE_YEAR);

        // Test at multiple points
        uint256 steps = 10;
        for (uint256 i = 1; i <= steps; i++) {
            vm.warp(block.timestamp + ONE_YEAR / steps);
            uint256 v = vesting.vestedAmount();
            assert(v > 0, "Vested should be > 0");
            assert(v <= MAX_ALLOCATION, "Vested should not exceed allocation");
        }
        // At end
        vm.warp(block.timestamp + 1);
        assert(vesting.vestedAmount() == MAX_ALLOCATION, "Should fully vest");
    }

    // =========================================
    // Test: Linear vesting curve accuracy to within 1 token unit
    // =========================================
    function test_vestingCurveAccuracy() public {
        uint256 alloc = 1_000_000 * 1e18;  // 1M tokens
        vesting = _deployVesting(alloc, 0, ONE_YEAR);

        // Check at quarterly intervals
        uint256 quarter = ONE_YEAR / 4;

        vm.warp(block.timestamp + quarter);
        uint256 v1 = vesting.vestedAmount();
        // Expected: ~25% = 250_000e18
        uint256 expected1 = alloc * quarter / ONE_YEAR;
        assert(_absDiff(v1, expected1) <= 1, "Q1 vesting inaccurate");

        vm.warp(block.timestamp + quarter);
        uint256 v2 = vesting.vestedAmount();
        uint256 expected2 = alloc * (2 * quarter) / ONE_YEAR;
        assert(_absDiff(v2, expected2) <= 1, "Q2 vesting inaccurate");

        vm.warp(block.timestamp + quarter);
        uint256 v3 = vesting.vestedAmount();
        uint256 expected3 = alloc * (3 * quarter) / ONE_YEAR;
        assert(_absDiff(v3, expected3) <= 1, "Q3 vesting inaccurate");

        vm.warp(block.timestamp + quarter + 1);
        uint256 v4 = vesting.vestedAmount();
        assert(v4 == alloc, "Q4 should be fully vested");
    }

    // =========================================
    // Test: Claim reverts for non-beneficiary
    // =========================================
    function test_claim_nonBeneficiary_reverts() public {
        vesting = _deployVesting(1000 * 1e18, 0, ONE_YEAR);
        vm.warp(block.timestamp + ONE_YEAR / 2);

        bool reverted = false;
        try vesting.claim() from (other) {
        } catch {
            reverted = true;
        }
        assert(reverted, "Non-beneficiary claim should revert");
    }

    // =========================================
    // Test: Revoke reverts for non-owner
    // =========================================
    function test_revoke_nonOwner_reverts() public {
        vesting = _deployVesting(1000 * 1e18, SIX_MONTHS, ONE_YEAR);

        bool reverted = false;
        try vesting.revoke() from (other) {
        } catch {
            reverted = true;
        }
        assert(reverted, "Non-owner revoke should revert");
    }

    // =========================================
    // Test: Double revoke reverts
    // =========================================
    function test_revoke_doubleRevoke_reverts() public {
        vesting = _deployVesting(1000 * 1e18, SIX_MONTHS, ONE_YEAR);
        vesting.revoke();

        bool reverted = false;
        try vesting.revoke() {
        } catch {
            reverted = true;
        }
        assert(reverted, "Double revoke should revert");
    }

    // =========================================
    // Test: Claim when nothing is claimable reverts
    // =========================================
    function test_claim_nothingClaimable_reverts() public {
        vesting = _deployVesting(1000 * 1e18, SIX_MONTHS, ONE_YEAR);
        // During cliff
        bool reverted = false;
        try vesting.claim() {
        } catch {
            reverted = true;
        }
        assert(reverted, "Claim during cliff should revert");
    }

    // =========================================
    // Test: Constructor validations
    // =========================================
    function test_constructor_zeroToken_reverts() public {
        bool reverted = false;
        try new TokenVesting(address(0), beneficiary, 1000, block.timestamp, 0, ONE_YEAR) {
        } catch {
            reverted = true;
        }
        assert(reverted, "Zero token should revert");
    }

    function test_constructor_zeroDuration_reverts() public {
        bool reverted = false;
        try new TokenVesting(address(token), beneficiary, 1000, block.timestamp, 0, 0) {
        } catch {
            reverted = true;
        }
        assert(reverted, "Zero duration should revert");
    }

    function test_constructor_cliffGtDuration_reverts() public {
        bool reverted = false;
        try new TokenVesting(address(token), beneficiary, 1000, block.timestamp, ONE_YEAR + 1, ONE_YEAR) {
        } catch {
            reverted = true;
        }
        assert(reverted, "Cliff > duration should revert");
    }

    // =========================================
    // Helpers
    // =========================================
    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    // Foundry cheatcodes interface
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
}

interface Vm {
    function warp(uint256) external;
}
