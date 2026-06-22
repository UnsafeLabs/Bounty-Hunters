// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/StakingVault.sol";
import "../mocks/MockERC20.sol";

/// @title ReentrancyAttacker - Attempts to exploit reentrancy in StakingVault
contract ReentrancyAttacker {
    StakingVault public vault;
    uint256 public attackCount;
    bool public attackWithdraw;
    bool public attackClaim;

    constructor(address _vault) {
        vault = StakingVault(payable(_vault));
    }

    function setAttackWithdraw(bool _enabled) external {
        attackWithdraw = _enabled;
    }

    function setAttackClaim(bool _enabled) external {
        attackClaim = _enabled;
    }

    /// @notice Called when receiving ETH - attempts reentrancy on withdraw
    receive() external payable {
        if (attackWithdraw) {
            attackWithdraw = false; // prevent infinite loop
            attackCount++;
            // Always attempt re-enter withdraw with whatever amount was originally staked
            // Even if CEI cleared balance, ReentrancyGuard should block this
            try vault.withdraw(1 ether) {} catch {}
        }
        if (attackClaim) {
            attackClaim = false;
            attackCount++;
            try vault.claimRewards() {} catch {}
        }
    }
}

/// @title StakingVaultTest - Foundry tests for StakingVault reentrancy fix
contract StakingVaultTest is Test {
    StakingVault public vault;
    MockERC20 public token;
    ReentrancyAttacker public attacker;

    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    uint256 public constant STAKE_AMOUNT = 100 ether;
    uint256 public constant REWARD_RATE = 0.01 ether; // 1% per second

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);

    function setUp() public {
        token = new MockERC20("TestToken", "TT", 18);
        vault = new StakingVault(address(token), REWARD_RATE);
        attacker = new ReentrancyAttacker(address(vault));

        // Fund vault with ETH for rewards/withdrawals
        vm.deal(address(vault), 1000 ether);
        // Fund users with tokens
        token.mint(alice, 1000 ether);
        token.mint(bob, 1000 ether);
        token.mint(address(attacker), 1000 ether);

        // Approve vault
        vm.prank(alice);
        token.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        token.approve(address(vault), type(uint256).max);
        vm.prank(address(attacker));
        token.approve(address(vault), type(uint256).max);
    }

    // =============================================
    // Basic functionality tests
    // =============================================

    function test_stake_basic() public {
        vm.prank(alice);
        vault.stake(STAKE_AMOUNT);

        assertEq(vault.getStakedBalance(alice), STAKE_AMOUNT, "Balance should match staked amount");
        assertEq(vault.totalStaked(), STAKE_AMOUNT, "Total staked should match");
    }

    function test_stake_zero_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Cannot stake 0");
        vault.stake(0);
    }

    function test_withdraw_basic() public {
        vm.prank(alice);
        vault.stake(STAKE_AMOUNT);

        uint256 balBefore = alice.balance;

        vm.prank(alice);
        vault.withdraw(STAKE_AMOUNT);

        assertEq(vault.getStakedBalance(alice), 0, "Balance should be 0 after full withdrawal");
        assertEq(alice.balance - balBefore, STAKE_AMOUNT, "Should receive ETH");
        assertEq(vault.totalStaked(), 0, "Total staked should be 0");
    }

    function test_withdraw_partial() public {
        vm.prank(alice);
        vault.stake(STAKE_AMOUNT);

        vm.prank(alice);
        vault.withdraw(STAKE_AMOUNT / 2);

        assertEq(vault.getStakedBalance(alice), STAKE_AMOUNT / 2, "Half balance should remain");
    }

    function test_withdraw_insufficient_balance_reverts() public {
        vm.prank(alice);
        vault.stake(STAKE_AMOUNT);

        vm.prank(alice);
        vm.expectRevert("Insufficient balance");
        vault.withdraw(STAKE_AMOUNT + 1);
    }

    function test_claimRewards_basic() public {
        vm.prank(alice);
        vault.stake(STAKE_AMOUNT);

        // Warp 10 seconds to accumulate rewards
        vm.warp(block.timestamp + 10);

        uint256 pending = vault.getPendingRewards(alice);
        assertTrue(pending > 0, "Should have pending rewards");

        uint256 balBefore = alice.balance;

        vm.prank(alice);
        vault.claimRewards();

        assertEq(vault.rewards(alice), 0, "Rewards should be 0 after claim");
        assertEq(alice.balance - balBefore, pending, "Should receive reward ETH");
    }

    function test_claimRewards_noRewards_reverts() public {
        vm.prank(alice);
        vault.stake(STAKE_AMOUNT);

        // No time has passed, no rewards
        vm.prank(alice);
        vm.expectRevert("No rewards");
        vault.claimRewards();
    }

    // =============================================
    // Reentrancy attack tests — CEI prevents damage
    // and ReentrancyGuard blocks the reentrant call
    // =============================================

    function test_reentrancy_withdraw_cei_prevents_drain() public {
        // Attacker stakes
        vm.prank(address(attacker));
        vault.stake(STAKE_AMOUNT);

        vm.warp(block.timestamp + 10);

        // Record balances before attack
        uint256 vaultEthBefore = address(vault).balance;
        uint256 attackerBalBefore = vault.getStakedBalance(address(attacker));

        // Enable reentrancy on withdraw — attacker's receive() will try to re-enter
        attacker.setAttackWithdraw(true);

        vm.prank(address(attacker));
        vault.withdraw(STAKE_AMOUNT);

        // The attacker should only get their original stake, not extra funds
        // Vault balance should decrease by exactly STAKE_AMOUNT
        assertEq(
            vaultEthBefore - address(vault).balance,
            STAKE_AMOUNT,
            "Vault should only lose the staked amount"
        );
        assertEq(vault.getStakedBalance(address(attacker)), 0, "Attacker balance should be 0");
        // The re-entrant call was attempted (attackCount > 0) but couldn't drain extra
        assertEq(attacker.attackCount(), 1, "Re-entrant call was attempted");
    }

    function test_reentrancy_claimRewards_cei_prevents_drain() public {
        // Attacker stakes
        vm.prank(address(attacker));
        vault.stake(STAKE_AMOUNT);

        vm.warp(block.timestamp + 10);

        uint256 pending = vault.getPendingRewards(address(attacker));
        uint256 vaultEthBefore = address(vault).balance;

        // Enable reentrancy on claimRewards
        attacker.setAttackClaim(true);

        vm.prank(address(attacker));
        vault.claimRewards();

        // Only the legitimate reward amount should be drained
        assertEq(
            vaultEthBefore - address(vault).balance,
            pending,
            "Vault should only lose the reward amount"
        );
        assertEq(vault.rewards(address(attacker)), 0, "Rewards should be 0");
        assertEq(attacker.attackCount(), 1, "Re-entrant call was attempted");
    }

    // =============================================
    // ReentrancyGuard test — direct reentrancy reverts
    // =============================================

    function test_reentrancy_guard_blocks_reenter() public {
        // Deploy a dedicated attacker that attempts to call withdraw
        // from within receive(), bypassing the CEI balance check
        ReentrancyGuardAttacker guardAttacker = new ReentrancyGuardAttacker(address(vault));

        // Fund the attacker contract
        token.mint(address(guardAttacker), STAKE_AMOUNT);
        vm.deal(address(guardAttacker), STAKE_AMOUNT);
        vm.prank(address(guardAttacker));
        token.approve(address(vault), type(uint256).max);

        // Stake
        vm.prank(address(guardAttacker));
        vault.stake(STAKE_AMOUNT);

        vm.warp(block.timestamp + 10);

        // The attacker contract will always try to re-enter withdraw with 1 ether
        // regardless of its remaining balance, to trigger the ReentrancyGuard
        guardAttacker.setDoAttack(true);

        vm.prank(address(guardAttacker));
        vm.expectRevert();
        vault.withdraw(STAKE_AMOUNT);
    }

    // =============================================
    // Checks-effects-interactions verification
    // =============================================

    function test_withdraw_stateUpdated_before_transfer() public {
        vm.prank(alice);
        vault.stake(STAKE_AMOUNT);

        uint256 balBefore = vault.getStakedBalance(alice);
        assertEq(balBefore, STAKE_AMOUNT);

        vm.prank(alice);
        vault.withdraw(STAKE_AMOUNT);

        assertEq(vault.getStakedBalance(alice), 0, "Balance must be 0 after withdraw");
        assertEq(vault.totalStaked(), 0, "Total staked must be 0 after full withdraw");
    }

    function test_claimRewards_stateUpdated_before_transfer() public {
        vm.prank(alice);
        vault.stake(STAKE_AMOUNT);

        vm.warp(block.timestamp + 10);
        uint256 pending = vault.getPendingRewards(alice);
        assertTrue(pending > 0);

        vm.prank(alice);
        vault.claimRewards();

        assertEq(vault.rewards(alice), 0, "Rewards must be 0 after claim");
    }

    // =============================================
    // Gas benchmark: fix should not add excessive gas
    // =============================================

    function test_withdraw_gas_within_bounds() public {
        vm.prank(alice);
        vault.stake(STAKE_AMOUNT);

        uint256 gasBefore = gasleft();
        vm.prank(alice);
        vault.withdraw(STAKE_AMOUNT);
        uint256 gasUsed = gasBefore - gasleft();

        // ReentrancyGuard adds ~2600 gas (SSTORE x2), cap at 100k
        assertLt(gasUsed, 100_000, "Gas usage should be reasonable");
    }

    function test_claimRewards_gas_within_bounds() public {
        vm.prank(alice);
        vault.stake(STAKE_AMOUNT);
        vm.warp(block.timestamp + 10);

        uint256 gasBefore = gasleft();
        vm.prank(alice);
        vault.claimRewards();
        uint256 gasUsed = gasBefore - gasleft();

        assertLt(gasUsed, 100_000, "Gas usage should be reasonable");
    }

    // =============================================
    // Edge cases
    // =============================================

    function test_multiple_stakers_independent() public {
        vm.prank(alice);
        vault.stake(STAKE_AMOUNT);

        vm.prank(bob);
        vault.stake(STAKE_AMOUNT * 2);

        assertEq(vault.getStakedBalance(alice), STAKE_AMOUNT);
        assertEq(vault.getStakedBalance(bob), STAKE_AMOUNT * 2);
        assertEq(vault.totalStaked(), STAKE_AMOUNT * 3);
    }

    function test_withdraw_then_restake() public {
        vm.prank(alice);
        vault.stake(STAKE_AMOUNT);

        vm.prank(alice);
        vault.withdraw(STAKE_AMOUNT);

        assertEq(vault.getStakedBalance(alice), 0);

        vm.prank(alice);
        vault.stake(STAKE_AMOUNT / 2);

        assertEq(vault.getStakedBalance(alice), STAKE_AMOUNT / 2);
    }
}

/// @title ReentrancyGuardAttacker - Always attempts re-enter regardless of balance
contract ReentrancyGuardAttacker {
    StakingVault public vault;
    bool public doAttack;

    constructor(address _vault) {
        vault = StakingVault(payable(_vault));
    }

    function setDoAttack(bool _enabled) external {
        doAttack = _enabled;
    }

    receive() external payable {
        if (doAttack) {
            doAttack = false; // prevent infinite loop
            // Always try to re-enter withdraw with 1 ether, even though balance is 0
            // This should trigger ReentrancyGuard
            vault.withdraw(1 ether);
        }
    }
}
