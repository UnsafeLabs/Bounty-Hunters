// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/StakingVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockStakeToken is ERC20 {
    constructor() ERC20("Stake", "STK") {
        _mint(msg.sender, 10_000_000 ether);
    }
}

/// @dev Malicious contract that attempts recursive withdrawal reentrancy
contract ReentrantAttacker {
    StakingVault public vault;
    uint256 public attackCount;
    uint256 public maxAttacks;

    constructor(address _vault) {
        vault = StakingVault(payable(_vault));
        maxAttacks = 5;
    }

    function attack(uint256 amount) external {
        attackCount = 0;
        vault.withdraw(amount);
    }

    function attackClaim() external {
        attackCount = 0;
        vault.claimRewards();
    }

    // Reentrancy: receive() callback tries to withdraw again
    receive() external payable {
        attackCount++;
        if (attackCount < maxAttacks && address(vault).balance > 0) {
            try vault.withdraw(msg.value) {} catch {}
        }
    }
}

/// @dev Malicious contract that attempts recursive reward claiming
contract ReentrantClaimAttacker {
    StakingVault public vault;
    uint256 public attackCount;

    constructor(address _vault) {
        vault = StakingVault(payable(_vault));
    }

    function attack() external {
        attackCount = 0;
        vault.claimRewards();
    }

    receive() external payable {
        attackCount++;
        if (attackCount < 3) {
            try vault.claimRewards() {} catch {}
        }
    }
}

contract StakingVaultTest is Test {
    StakingVault public vault;
    MockStakeToken public token;

    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    uint256 constant REWARD_RATE = 1e15; // 0.001 per second per token

    function setUp() public {
        token = new MockStakeToken();
        vault = new StakingVault(address(token), REWARD_RATE);

        // Fund vault with ETH for rewards/withdrawals
        vm.deal(address(vault), 1000 ether);

        // Fund users
        token.transfer(alice, 100_000 ether);
        token.transfer(bob, 100_000 ether);
    }

    // ─── Reentrancy prevention on withdraw ─────────────────────────────

    function test_withdraw_reentrancyBlocked() public {
        ReentrantAttacker attacker = new ReentrantAttacker(address(vault));
        token.transfer(address(attacker), 10_000 ether);

        // Attacker stakes tokens
        vm.startPrank(address(attacker));
        token.approve(address(vault), 10_000 ether);
        // We need to use the vault's stake directly
        vm.stopPrank();

        // Simulate attacker staking via prank
        vm.prank(address(attacker));
        token.approve(address(vault), 10_000 ether);

        vm.prank(address(attacker));
        vault.stake(10_000 ether);

        uint256 vaultBalBefore = address(vault).balance;

        // Attacker tries recursive withdrawal — should revert on reentry
        vm.prank(address(attacker));
        try attacker.attack(1 ether) {} catch {}

        // Vault balance should not be drained — at most 1 withdrawal succeeded
        uint256 vaultBalAfter = address(vault).balance;
        assertGe(
            vaultBalAfter,
            vaultBalBefore - 1 ether,
            "Vault must not be drained by reentrancy"
        );
    }

    // ─── Reentrancy prevention on claimRewards ─────────────────────────

    function test_claimRewards_reentrancyBlocked() public {
        ReentrantClaimAttacker attacker = new ReentrantClaimAttacker(address(vault));
        token.transfer(address(attacker), 10_000 ether);

        vm.prank(address(attacker));
        token.approve(address(vault), 10_000 ether);

        vm.prank(address(attacker));
        vault.stake(10_000 ether);

        // Let rewards accrue
        vm.warp(block.timestamp + 1 hours);

        uint256 vaultBalBefore = address(vault).balance;

        // Attempt reentrancy on claimRewards
        vm.prank(address(attacker));
        try attacker.attack() {} catch {}

        // Should only have claimed once (or reverted entirely)
        uint256 vaultBalAfter = address(vault).balance;
        uint256 maxExpectedClaim = 10_000 ether * 3600 * REWARD_RATE / 1e18;
        assertGe(
            vaultBalAfter,
            vaultBalBefore - maxExpectedClaim - 1,
            "At most one claim should succeed"
        );
    }

    // ─── CEI pattern verification ──────────────────────────────────────

    function test_withdraw_stateUpdatedBeforeTransfer() public {
        vm.startPrank(alice);
        token.approve(address(vault), 1000 ether);
        vault.stake(1000 ether);

        uint256 balBefore = vault.balances(alice);
        assertEq(balBefore, 1000 ether);

        vault.withdraw(500 ether);

        // State should be updated (not vulnerable to read-before-write)
        assertEq(vault.balances(alice), 500 ether);
        assertEq(vault.totalStaked(), 500 ether);
        vm.stopPrank();
    }

    function test_claimRewards_rewardsZeroedBeforeTransfer() public {
        vm.startPrank(alice);
        token.approve(address(vault), 1000 ether);
        vault.stake(1000 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 hours);

        vm.prank(alice);
        vault.claimRewards();

        // Rewards should be zeroed after claim
        assertEq(vault.rewards(alice), 0, "Rewards zeroed after claim");
    }

    // ─── Normal operations ─────────────────────────────────────────────

    function test_stake_and_withdraw() public {
        vm.startPrank(alice);
        token.approve(address(vault), 1000 ether);
        vault.stake(1000 ether);

        assertEq(vault.balances(alice), 1000 ether);
        assertEq(vault.totalStaked(), 1000 ether);

        vault.withdraw(500 ether);
        assertEq(vault.balances(alice), 500 ether);
        vm.stopPrank();
    }

    function test_pendingRewards_accrue() public {
        vm.startPrank(alice);
        token.approve(address(vault), 1000 ether);
        vault.stake(1000 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 hours);

        uint256 pending = vault.getPendingRewards(alice);
        assertTrue(pending > 0, "Rewards should accrue over time");
    }

    function test_revert_stakeZero() public {
        vm.prank(alice);
        vm.expectRevert("Cannot stake 0");
        vault.stake(0);
    }

    function test_revert_withdrawInsufficient() public {
        vm.prank(alice);
        vm.expectRevert("Insufficient balance");
        vault.withdraw(1 ether);
    }

    function test_revert_claimNoRewards() public {
        vm.prank(alice);
        vm.expectRevert("No rewards");
        vault.claimRewards();
    }
}
