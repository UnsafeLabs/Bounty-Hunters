// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/YieldVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {
        _mint(msg.sender, 10_000_000 ether);
    }
}

contract YieldVaultTest is Test {
    YieldVault public vault;
    MockToken public stakingToken;
    MockToken public rewardToken;

    address public distributor = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    uint256 constant REWARD = 100_000 ether;
    uint256 constant DURATION = 30 days;

    function setUp() public {
        stakingToken = new MockToken("Staking", "STK");
        rewardToken = new MockToken("Reward", "RWD");
        vault = new YieldVault(address(stakingToken), address(rewardToken));

        // Fund vault with rewards
        rewardToken.transfer(address(vault), REWARD);

        // Fund users
        stakingToken.transfer(alice, 100_000 ether);
        stakingToken.transfer(bob, 100_000 ether);
    }

    // ─── Phantom reward prevention ─────────────────────────────────────

    function test_noPhantomRewardsAfterPeriodEnd() public {
        // Start reward period
        vault.notifyRewardAmount(REWARD, DURATION);

        // Alice deposits
        vm.startPrank(alice);
        stakingToken.approve(address(vault), 10_000 ether);
        vault.deposit(10_000 ether);
        vm.stopPrank();

        // Warp to exactly period end
        vm.warp(block.timestamp + DURATION);
        uint256 earnedAtEnd = vault.earned(alice);

        // Warp PAST period end by another 30 days
        vm.warp(block.timestamp + 30 days);
        uint256 earnedAfterEnd = vault.earned(alice);

        // Rewards must NOT increase after period finishes
        assertEq(
            earnedAtEnd,
            earnedAfterEnd,
            "No phantom rewards should accrue after period ends"
        );
    }

    function test_rewardPerToken_capsAtPeriodFinish() public {
        vault.notifyRewardAmount(REWARD, DURATION);

        vm.startPrank(alice);
        stakingToken.approve(address(vault), 10_000 ether);
        vault.deposit(10_000 ether);
        vm.stopPrank();

        // At period end
        vm.warp(block.timestamp + DURATION);
        uint256 rptAtEnd = vault.rewardPerToken();

        // 60 days past period end
        vm.warp(block.timestamp + 60 days);
        uint256 rptAfter = vault.rewardPerToken();

        assertEq(rptAtEnd, rptAfter, "rewardPerToken must stop increasing");
    }

    // ─── Access control ────────────────────────────────────────────────

    function test_revert_notifyRewardAmount_unauthorized() public {
        vm.prank(alice);
        vm.expectRevert("Not authorized");
        vault.notifyRewardAmount(REWARD, DURATION);
    }

    function test_notifyRewardAmount_authorizedDistributor() public {
        // Deployer = distributor — should succeed
        vault.notifyRewardAmount(REWARD, DURATION);
        assertTrue(vault.periodFinish() > block.timestamp);
    }

    // ─── Precision: rewards not lost to truncation ─────────────────────

    function test_precision_smallRewardLongDuration() public {
        // 1 token over 365 days — old code: rewardRate = 0 (truncated!)
        // New code: rewardRate = 1e18 / 365 days ≈ 31709791983 (preserves precision)
        vault.notifyRewardAmount(1 ether, 365 days);
        assertTrue(vault.rewardRate() > 0, "Rate should not truncate to 0");

        vm.startPrank(alice);
        stakingToken.approve(address(vault), 10_000 ether);
        vault.deposit(10_000 ether);
        vm.stopPrank();

        // After full period, alice should earn ~1 ether
        vm.warp(block.timestamp + 365 days);
        uint256 aliceEarned = vault.earned(alice);

        // Allow 1% tolerance for rounding
        assertGt(aliceEarned, 0.99 ether, "Should earn close to 1 token");
        assertLt(aliceEarned, 1.01 ether, "Should not exceed 1 token");
    }

    // ─── Deposit / Withdraw / Claim flow ───────────────────────────────

    function test_fullLifecycle() public {
        vault.notifyRewardAmount(REWARD, DURATION);

        // Alice deposits
        vm.startPrank(alice);
        stakingToken.approve(address(vault), 50_000 ether);
        vault.deposit(50_000 ether);
        vm.stopPrank();

        // Half period passes
        vm.warp(block.timestamp + DURATION / 2);

        // Alice claims mid-period
        uint256 rewardBalBefore = rewardToken.balanceOf(alice);
        vm.prank(alice);
        vault.claimReward();
        uint256 midReward = rewardToken.balanceOf(alice) - rewardBalBefore;
        assertTrue(midReward > 0, "Should have mid-period rewards");

        // Full period passes
        vm.warp(block.timestamp + DURATION / 2);

        // Alice withdraws + claims
        vm.startPrank(alice);
        vault.withdraw(50_000 ether);
        vault.claimReward();
        vm.stopPrank();

        assertEq(vault.balanceOf(alice), 0, "Fully withdrawn");
    }

    // ─── Deposit after period ends ─────────────────────────────────────

    function test_depositAfterPeriodEnd_noPhantomRewards() public {
        vault.notifyRewardAmount(REWARD, DURATION);

        // Period ends
        vm.warp(block.timestamp + DURATION + 1 days);

        // Bob deposits AFTER period has ended
        vm.startPrank(bob);
        stakingToken.approve(address(vault), 10_000 ether);
        vault.deposit(10_000 ether);
        vm.stopPrank();

        // Wait another 30 days
        vm.warp(block.timestamp + 30 days);

        // Bob should have earned ZERO — period already ended
        uint256 bobEarned = vault.earned(bob);
        assertEq(bobEarned, 0, "No rewards after period end");
    }

    // ─── Edge cases ────────────────────────────────────────────────────

    function test_revert_depositZero() public {
        vm.prank(alice);
        vm.expectRevert("Cannot deposit 0");
        vault.deposit(0);
    }

    function test_revert_withdrawZero() public {
        vm.prank(alice);
        vm.expectRevert("Cannot withdraw 0");
        vault.withdraw(0);
    }

    function test_revert_withdrawMoreThanBalance() public {
        vault.notifyRewardAmount(REWARD, DURATION);

        vm.startPrank(alice);
        stakingToken.approve(address(vault), 1000 ether);
        vault.deposit(1000 ether);

        vm.expectRevert("Insufficient balance");
        vault.withdraw(2000 ether);
        vm.stopPrank();
    }
}
