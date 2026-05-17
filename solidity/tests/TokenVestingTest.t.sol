// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/TokenVesting.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {
        _mint(msg.sender, 1000000000 * 10**18);
    }
}

contract TokenVestingTest is Test {
    TokenVesting public vesting;
    MockToken public token;
    address public beneficiary = address(0x1);
    address public owner = address(this);

    uint256 public constant TOTAL_ALLOCATION = 1000000000 * 10**18; // 1 billion
    uint256 public constant DURATION = 365 days;
    uint256 public constant CLIFF = 90 days;
    uint256 public start;

    function setUp() public {
        token = new MockToken();
        start = block.timestamp;
        vesting = new TokenVesting(
            address(token),
            beneficiary,
            TOTAL_ALLOCATION,
            start,
            CLIFF,
            DURATION
        );
        token.transfer(address(vesting), TOTAL_ALLOCATION);
    }

    function test_overflow_protection() public {
        // Even with 1 billion tokens and 18 decimals, calculation should not overflow
        vm.warp(start + CLIFF);
        uint256 vested = vesting.vestedAmount();
        assertTrue(vested > 0);
        
        vm.warp(start + DURATION);
        assertEq(vesting.vestedAmount(), TOTAL_ALLOCATION);
    }

    function test_revocation_during_cliff() public {
        vm.warp(start + CLIFF / 2);
        vesting.revoke();
        
        assertEq(token.balanceOf(beneficiary), 0);
        assertEq(token.balanceOf(owner), TOTAL_ALLOCATION);
    }

    function test_revocation_after_cliff() public {
        vm.warp(start + CLIFF + 10 days);
        uint256 vested = vesting.vestedAmount();
        uint256 unvested = TOTAL_ALLOCATION - vested;
        
        vesting.revoke();
        
        assertEq(token.balanceOf(beneficiary), vested);
        assertEq(token.balanceOf(owner), unvested);
    }

    function test_full_vesting_completion() public {
        vm.warp(start + DURATION);
        assertEq(vesting.vestedAmount(), TOTAL_ALLOCATION);
        
        vm.prank(beneficiary);
        vesting.claim();
        
        assertEq(token.balanceOf(beneficiary), TOTAL_ALLOCATION);
    }

    function test_remainder_accuracy() public {
        // Use a duration that doesn't evenly divide the allocation
        uint256 oddAllocation = 1000000000 * 10**18 + 7;
        vesting = new TokenVesting(
            address(token),
            beneficiary,
            oddAllocation,
            start,
            0,
            DURATION
        );
        token.transfer(address(vesting), oddAllocation);

        vm.warp(start + DURATION);
        assertEq(vesting.vestedAmount(), oddAllocation);
    }
}
