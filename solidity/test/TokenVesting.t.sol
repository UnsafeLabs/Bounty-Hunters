// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/TokenVesting.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract TokenVestingTest is Test {
    TokenVesting public vesting;
    MockToken public token;
    address public owner = address(0x11);
    address public beneficiary = address(0x22);

    function setUp() public {
        token = new MockToken();
        token.mint(owner, 1000000000000 * 1e18); // Big amount
    }

    function test_OverflowLargeAllocation() public {
        uint256 largeAllocation = 1000000000 * 1e18; // 1 billion tokens
        uint256 start = block.timestamp;
        uint256 cliffDuration = 30 days;
        uint256 duration = 1000 days;
        
        vm.startPrank(owner);
        vesting = new TokenVesting(address(token), beneficiary, largeAllocation, start, cliffDuration, duration);
        token.transfer(address(vesting), largeAllocation);
        vm.stopPrank();

        vm.warp(start + 500 days);
        uint256 vested = vesting.vestedAmount();
        assertEq(vested, largeAllocation / 2);
    }

    function test_RemainderHandling() public {
        uint256 alloc = 1000;
        uint256 start = block.timestamp;
        uint256 cliffDuration = 0;
        uint256 duration = 300; 
        
        vm.startPrank(owner);
        vesting = new TokenVesting(address(token), beneficiary, alloc, start, cliffDuration, duration);
        token.transfer(address(vesting), alloc);
        vm.stopPrank();

        vm.warp(start + 100);
        assertEq(vesting.vestedAmount(), 333);

        vm.warp(start + 300);
        assertEq(vesting.vestedAmount(), 1000);
    }

    function test_RevokeDuringCliff() public {
        uint256 alloc = 1000;
        uint256 start = block.timestamp;
        uint256 cliffDuration = 30 days;
        uint256 duration = 100 days;

        uint256 initBal = token.balanceOf(owner);

        vm.startPrank(owner);
        vesting = new TokenVesting(address(token), beneficiary, alloc, start, cliffDuration, duration);
        token.transfer(address(vesting), alloc);
        vm.stopPrank();

        vm.warp(start + 10 days); // During cliff

        vm.prank(owner);
        vesting.revoke();

        assertEq(token.balanceOf(owner), initBal); // Gets it all back
        assertEq(token.balanceOf(beneficiary), 0);
    }

    function test_RevokePostCliff() public {
        uint256 alloc = 1000;
        uint256 start = block.timestamp;
        uint256 cliffDuration = 30 days;
        uint256 duration = 100 days;

        uint256 initBal = token.balanceOf(owner);

        vm.startPrank(owner);
        vesting = new TokenVesting(address(token), beneficiary, alloc, start, cliffDuration, duration);
        token.transfer(address(vesting), alloc);
        vm.stopPrank();

        vm.warp(start + 50 days); // 50% vested

        vm.prank(owner);
        vesting.revoke();

        assertEq(token.balanceOf(beneficiary), 500); 
        assertEq(token.balanceOf(owner), initBal - 500);
    }
}
