// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "./TokenVesting.sol";

contract SimpleERC20 {
    string public name = "Test";
    string public symbol = "TST";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        balanceOf[msg.sender] = type(uint256).max;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(balanceOf[msg.sender] >= value, "insufficient balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(balanceOf[from] >= value, "insufficient balance");
        require(allowance[from][msg.sender] >= value, "insufficient allowance");
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
        return true;
    }
}

contract TokenVestingTest is Test {
    TokenVesting vesting;
    SimpleERC20 token;
    address beneficiary = address(0xBEEF);
    address owner;

    uint256 constant MAX_ALLOCATION = 1_000_000_000e18; // 1 billion tokens with 18 decimals
    uint256 constant START = 1_000_000;
    uint256 constant CLIFF_DURATION = 365 days;
    uint256 constant VESTING_DURATION = 4 * 365 days;
    uint256 constant CLIFF = START + CLIFF_DURATION;
    uint256 constant END = START + VESTING_DURATION;

    function setUp() public {
        owner = address(this);
        token = new SimpleERC20();
        vesting = new TokenVesting(
            address(token),
            beneficiary,
            MAX_ALLOCATION,
            START,
            CLIFF_DURATION,
            VESTING_DURATION
        );
        token.transfer(address(vesting), MAX_ALLOCATION);
    }

    // Acceptance: maximum allocation overflow protection
    function test_MaxAllocationNoOverflow() public {
        vm.warp(CLIFF + VESTING_DURATION / 2);
        // Should not revert for 1 billion * 1e18 allocation
        uint256 vested = vesting.vestedAmount();
        assertTrue(vested > 0);
        assertTrue(vested < MAX_ALLOCATION);
    }

    // Acceptance: cliff period revocation
    function test_CliffPeriodRevocation() public {
        vm.warp(START + 1);

        uint256 ownerBalBefore = token.balanceOf(owner);
        vesting.revoke();

        assertTrue(vesting.revoked());
        assertEq(token.balanceOf(beneficiary), 0);
        // Owner recovers full allocation during cliff
        assertEq(token.balanceOf(owner), ownerBalBefore + MAX_ALLOCATION);
    }

    // Acceptance: post-cliff revocation returns only truly unvested tokens
    function test_PostCliffRevocation() public {
        vm.warp(CLIFF + VESTING_DURATION / 2);

        uint256 vested = vesting.vestedAmount();

        // Beneficiary claims some tokens
        vm.prank(beneficiary);
        vesting.claim();
        uint256 claimed = MAX_ALLOCATION - vesting.claimable();

        uint256 unvested = MAX_ALLOCATION - vested;
        uint256 unpaidVested = vested - claimed;

        uint256 ownerBalBefore = token.balanceOf(owner);
        uint256 benBalBefore = token.balanceOf(beneficiary);

        vesting.revoke();

        // Beneficiary got their unpaid vested tokens
        assertEq(token.balanceOf(beneficiary), benBalBefore + unpaidVested);
        // Owner got the truly unvested tokens
        assertEq(token.balanceOf(owner), ownerBalBefore + unvested);
    }

    // Acceptance: cliff period revocation with partial claims (if possible)
    function test_RevocationBeforeCliff() public {
        vm.warp(START + CLIFF_DURATION - 1);

        // Should return 0 during cliff
        assertEq(vesting.vestedAmount(), 0);

        uint256 ownerBalBefore = token.balanceOf(owner);
        vesting.revoke();

        assertTrue(vesting.revoked());
        // Owner gets full allocation since nothing was vested or claimed
        assertEq(token.balanceOf(owner), ownerBalBefore + MAX_ALLOCATION);
    }

    // Acceptance: full vesting completion
    function test_FullVestingCompletion() public {
        vm.warp(END + 1);

        uint256 vested = vesting.vestedAmount();
        assertEq(vested, MAX_ALLOCATION);

        vm.prank(beneficiary);
        vesting.claim();

        assertEq(vesting.claimed(), MAX_ALLOCATION);
        assertEq(token.balanceOf(beneficiary), MAX_ALLOCATION);
    }

    // Acceptance: remainder accuracy — total claimed equals total allocation at vesting end
    function test_RemainderAccuracy() public {
        // Use an uneven allocation that would cause truncation
        uint256 unevenAllocation = 1_000_000_007; // Not evenly divisible by duration
        SimpleERC20 token2 = new SimpleERC20();
        TokenVesting vesting2 = new TokenVesting(
            address(token2),
            beneficiary,
            unevenAllocation,
            START,
            CLIFF_DURATION,
            VESTING_DURATION
        );
        token2.transfer(address(vesting2), unevenAllocation);

        // Advance past full vesting
        vm.warp(END + 1);

        uint256 vested = vesting2.vestedAmount();
        assertEq(vested, unevenAllocation);

        vm.prank(beneficiary);
        vesting2.claim();

        assertEq(vesting2.claimed(), unevenAllocation);
        assertEq(token2.balanceOf(beneficiary), unevenAllocation);
    }

    // Acceptance: linear vesting curve is accurate to within 1 token unit over full period
    function test_VestingCurveAccuracy() public {
        uint256 smallAllocation = 1_000_000e18;
        SimpleERC20 token3 = new SimpleERC20();
        TokenVesting vesting3 = new TokenVesting(
            address(token3),
            beneficiary,
            smallAllocation,
            START,
            CLIFF_DURATION,
            VESTING_DURATION
        );
        token3.transfer(address(vesting3), smallAllocation);

        uint256 samples = 20;
        uint256 step = VESTING_DURATION / samples;

        for (uint256 i = 1; i <= samples; i++) {
            vm.warp(CLIFF + i * step);
            uint256 actual = vesting3.vestedAmount();
            uint256 expected = smallAllocation * (CLIFF + i * step - START) / VESTING_DURATION;
            // Deviation must be within 1 token
            int256 diff = int256(actual) - int256(expected);
            assertTrue(diff >= -1 && diff <= 1, "Vesting curve deviation exceeds 1 token");
        }
    }

    // Acceptance: revocation after partial vesting with no claims
    function test_PostCliffRevocationNoClaims() public {
        vm.warp(CLIFF + VESTING_DURATION / 2);

        uint256 vested = vesting.vestedAmount();
        uint256 unvested = MAX_ALLOCATION - vested;

        uint256 ownerBalBefore = token.balanceOf(owner);

        vesting.revoke();

        // With no claims, vested == 0 so beneficiary gets full vested amount
        assertEq(token.balanceOf(beneficiary), vested);
        // Owner gets unvested
        assertEq(token.balanceOf(owner), ownerBalBefore + unvested);
    }

    // Extra: revocation after full vesting
    function test_RevocationAfterFullVesting() public {
        vm.warp(END + 1);

        vm.prank(beneficiary);
        vesting.claim();
        assertEq(token.balanceOf(beneficiary), MAX_ALLOCATION);

        uint256 ownerBalBefore = token.balanceOf(owner);
        vesting.revoke();

        // Beneficiary got everything, nothing left for owner
        assertEq(token.balanceOf(owner), ownerBalBefore);
    }
}
