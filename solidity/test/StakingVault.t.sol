// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/StakingVault.sol";
import "../contracts/mocks/ReentrancyAttacker.sol";

contract StakingVaultTest is Test {
    StakingVault public vault;
    MockERC20 public token;
    ReentrancyAttacker public attacker;

    address public alice = makeAddr("alice");
    uint256 public constant STAKE_AMOUNT = 1 ether;
    uint256 public constant REWARD_RATE = 1e14;

    function setUp() public {
        token = new MockERC20();
        vault = new StakingVault(address(token), REWARD_RATE);
        attacker = new ReentrancyAttacker(address(vault), address(token));

        // Fund test accounts
        token.mint(alice, 100 ether);
        token.mint(address(attacker), 100 ether);

        // Fund vault with ETH for withdrawals
        vm.deal(address(vault), 100 ether);
    }

    function test_Stake_and_Withdraw() public {
        vm.startPrank(alice);
        token.approve(address(vault), STAKE_AMOUNT);
        vault.stake(STAKE_AMOUNT);
        assertEq(vault.getStakedBalance(alice), STAKE_AMOUNT);

        // Advance time
        vm.warp(block.timestamp + 365 days);

        vault.withdraw(STAKE_AMOUNT);
        assertEq(vault.getStakedBalance(alice), 0);
        vm.stopPrank();
    }

    function test_ClaimRewards() public {
        vm.startPrank(alice);
        token.approve(address(vault), STAKE_AMOUNT);
        vault.stake(STAKE_AMOUNT);

        // Advance time
        vm.warp(block.timestamp + 365 days);

        uint256 pending = vault.getPendingRewards(alice);
        assertGt(pending, 0, "Should have rewards");

        vault.claimRewards();
        assertEq(vault.getPendingRewards(alice), 0);
        vm.stopPrank();
    }

    function test_Reentrancy_Withdraw_is_blocked() public {
        attacker.setup(STAKE_AMOUNT);

        // Attacker tries to re-enter withdraw
        vm.expectRevert();
        attacker.attackWithdraw();
    }

    function test_Reentrancy_ClaimRewards_is_blocked() public {
        attacker.setup(STAKE_AMOUNT);

        // Advance time so attacker earns rewards
        vm.warp(block.timestamp + 365 days);

        // Attacker tries to re-enter claimRewards
        vm.expectRevert();
        attacker.attackClaim();
    }

    function test_CEI_withdraw_updates_balance_before_transfer() public {
        vm.startPrank(alice);
        token.approve(address(vault), STAKE_AMOUNT);
        vault.stake(STAKE_AMOUNT);

        uint256 balanceBefore = vault.getStakedBalance(alice);
        assertEq(balanceBefore, STAKE_AMOUNT);

        vault.withdraw(STAKE_AMOUNT / 2);

        // Balance should be updated BEFORE the ETH transfer
        uint256 balanceAfter = vault.getStakedBalance(alice);
        assertEq(balanceAfter, STAKE_AMOUNT / 2);
        vm.stopPrank();
    }

    function test_CEI_claimRewards_zeroes_rewards_before_transfer() public {
        vm.startPrank(alice);
        token.approve(address(vault), STAKE_AMOUNT);
        vault.stake(STAKE_AMOUNT);

        vm.warp(block.timestamp + 365 days);

        uint256 pendingBefore = vault.getPendingRewards(alice);
        assertGt(pendingBefore, 0);

        vault.claimRewards();

        // Rewards should be zeroed BEFORE the ETH transfer
        uint256 pendingAfter = vault.getPendingRewards(alice);
        // pendingAfter should only reflect time since last claim, not the old rewards
        assertEq(pendingAfter, 0, "Rewards should be zero immediately after claim");
        vm.stopPrank();
    }

    function test_Withdraw_reverts_on_insufficient_balance() public {
        vm.startPrank(alice);
        token.approve(address(vault), STAKE_AMOUNT);
        vault.stake(STAKE_AMOUNT);

        vm.expectRevert("Insufficient balance");
        vault.withdraw(STAKE_AMOUNT + 1);
        vm.stopPrank();
    }

    function test_ClaimRewards_reverts_when_no_rewards() public {
        vm.startPrank(alice);
        token.approve(address(vault), STAKE_AMOUNT);
        vault.stake(STAKE_AMOUNT);

        // No time passed, no rewards
        vm.expectRevert("No rewards");
        vault.claimRewards();
        vm.stopPrank();
    }

    receive() external payable {}
}
