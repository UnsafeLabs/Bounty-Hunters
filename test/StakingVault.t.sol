// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/StakingVault.sol";

contract MockERC20 is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}

contract StakingVaultTest is Test {
    StakingVault public vault;
    MockERC20 public stakingToken;

    address public owner = vm.addr(1);
    address public user = vm.addr(2);

    function setUp() public {
        stakingToken = new MockERC20();

        vm.prank(owner);
        vault = new StakingVault(address(stakingToken), 100); // 1% reward rate

        stakingToken.mint(user, 1000 ether);
        stakingToken.mint(address(vault), 1000 ether);

        vm.prank(user);
        stakingToken.approve(address(vault), 1000 ether);
    }

    function test_Stake() public {
        vm.prank(user);
        vault.stake(100 ether);

        assertEq(vault.balances(user), 100 ether);
        assertEq(vault.totalStaked(), 100 ether);
    }

    function test_Withdraw() public {
        vm.prank(user);
        vault.stake(100 ether);

        vm.prank(user);
        vault.withdraw(50 ether);

        assertEq(vault.balances(user), 50 ether);
        assertEq(vault.totalStaked(), 50 ether);
    }

    function test_ClaimRewards() public {
        vm.prank(user);
        vault.stake(100 ether);

        vm.warp(block.timestamp + 1 days);

        vm.prank(user);
        vault.claimRewards();

        assertGt(stakingToken.balanceOf(user), 0);
    }

    function test_Withdraw_InsufficientBalance_Reverts() public {
        vm.prank(user);
        vault.stake(100 ether);

        vm.prank(user);
        vm.expectRevert("Insufficient balance");
        vault.withdraw(200 ether);
    }
}
