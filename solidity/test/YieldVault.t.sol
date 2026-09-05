// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/YieldVault.sol";
import "../contracts/mocks/ReentrancyAttacker.sol";

contract YieldVaultTest is Test {
    YieldVault public vault;
    MockERC20 public stakingToken;
    MockRewardToken public rewardToken;
    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public distributor = makeAddr("distributor");

    uint256 public constant STAKE_AMOUNT = 100 ether;
    uint256 public constant REWARD_AMOUNT = 1000 ether;
    uint256 public constant DURATION = 7 days;

    function setUp() public {
        vm.startPrank(owner);
        stakingToken = new MockERC20();
        rewardToken = new MockRewardToken();
        vault = new YieldVault(address(stakingToken), address(rewardToken));
        vm.stopPrank();

        // Fund accounts
        stakingToken.mint(alice, 1000 ether);
        stakingToken.mint(bob, 1000 ether);
        rewardToken.mint(distributor, 1_000_000 ether);

        // Approve and fund vault
        vm.prank(distributor);
        rewardToken.approve(address(vault), type(uint256).max);

        vm.prank(alice);
        stakingToken.approve(address(vault), type(uint256).max);

        vm.prank(bob);
        stakingToken.approve(address(vault), type(uint256).max);
    }

    function test_Deposit_and_Withdraw() public {
        vm.prank(alice);
        vault.deposit(STAKE_AMOUNT);
        assertEq(vault.balanceOf(alice), STAKE_AMOUNT);
        assertEq(vault.totalSupply(), STAKE_AMOUNT);

        vm.prank(alice);
        vault.withdraw(STAKE_AMOUNT / 2);
        assertEq(vault.balanceOf(alice), STAKE_AMOUNT / 2);
        assertEq(vault.totalSupply(), STAKE_AMOUNT / 2);
    }

    function test_RewardAccrual_DuringPeriod() public {
        // Start reward period
        vm.prank(distributor);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        // Alice deposits
        vm.prank(alice);
        vault.deposit(STAKE_AMOUNT);

        // Advance halfway through period
        vm.warp(block.timestamp + DURATION / 2);

        uint256 earnedAlice = vault.earned(alice);
        assertGt(earnedAlice, 0, "Should have earned rewards");

        // Should be approximately half of total rewards
        // (allowing for small precision differences)
        assertApproxEqRel(earnedAlice, REWARD_AMOUNT / 2, 1e16, "Should earn ~50% of rewards");
    }

    function test_NoPhantomRewards_AfterPeriod() public {
        // Start reward period
        vm.prank(distributor);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        // Alice deposits
        vm.prank(alice);
        vault.deposit(STAKE_AMOUNT);

        // Advance past the reward period
        vm.warp(block.timestamp + DURATION + 1 days);

        uint256 earnedAlice = vault.earned(alice);
        uint256 expectedReward = REWARD_AMOUNT; // Full reward

        // Should have earned exactly the full reward, no more
        assertApproxEqRel(earnedAlice, expectedReward, 1e16, "Should not earn more than total reward");
    }

    function test_EarnedReturnsZero_WhenNoDeposit() public {
        vm.prank(distributor);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        vm.warp(block.timestamp + DURATION / 2);

        assertEq(vault.earned(alice), 0, "Should earn nothing without deposit");
    }

    function test_OnlyDistributor_CanNotifyReward() public {
        vm.prank(alice);
        vm.expectRevert("Ownable: caller is not the owner");
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);
    }

    function test_CannotNotifyReward_BeforePeriodEnds() public {
        vm.prank(distributor);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        // Try to notify again before period ends
        vm.prank(distributor);
        vm.expectRevert("Reward period not finished");
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);
    }

    function test_PrecisionIsImproved() public {
        vm.prank(distributor);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        // rewardRate should be reward * 1e18 / duration
        uint256 expectedRate = REWARD_AMOUNT * 1e18 / DURATION;
        assertEq(vault.rewardRate(), expectedRate, "Reward rate should use 1e18 precision");
    }

    function test_SetRewardDistributor_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert("Ownable: caller is not the owner");
        vault.setRewardDistributor(bob);
    }

    function test_SetRewardDistributor_RevertZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("Invalid address");
        vault.setRewardDistributor(address(0));
    }

    function test_ClaimReward() public {
        vm.prank(distributor);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        vm.prank(alice);
        vault.deposit(STAKE_AMOUNT);

        vm.warp(block.timestamp + DURATION);

        uint256 balanceBefore = rewardToken.balanceOf(alice);

        vm.prank(alice);
        vault.claimReward();

        uint256 balanceAfter = rewardToken.balanceOf(alice);
        assertGt(balanceAfter - balanceBefore, 0, "Should have received rewards");
    }

    function test_MultipleUsers_ShareRewards_Proportionally() public {
        vm.prank(distributor);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        // Alice deposits 2x bob's amount
        vm.prank(alice);
        vault.deposit(STAKE_AMOUNT);

        vm.prank(bob);
        vault.deposit(STAKE_AMOUNT / 2);

        vm.warp(block.timestamp + DURATION);

        uint256 earnedAlice = vault.earned(alice);
        uint256 earnedBob = vault.earned(bob);

        // Alice should have earned approximately 2x bob's rewards
        // earnedAlice / earnedBob ≈ 2 (with some precision tolerance)
        assertApproxEqRel(earnedAlice / earnedBob, 2, 1e16, "Alice should earn 2x bob's rewards");
    }

    receive() external payable {}
}
