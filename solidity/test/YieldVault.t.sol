// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/YieldVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─────────────────────────────────────────────
// Mock ERC20 tokens for testing
// ─────────────────────────────────────────────
contract MockStakingToken is ERC20 {
    constructor() ERC20("Mock Staking", "mSTK") {
        _mint(msg.sender, 1_000_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockRewardToken is ERC20 {
    constructor() ERC20("Mock Reward", "mRWD") {
        _mint(msg.sender, 1_000_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ═══════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════
contract YieldVaultTest is Test {
    YieldVault public vault;
    MockStakingToken public stakingToken;
    MockRewardToken public rewardToken;

    address public distributor;
    address public alice;
    address public bob;
    address public carol;
    address public nonDistributor;

    uint256 constant REWARD_AMOUNT = 1000e18;
    uint256 constant DURATION = 1000; // 1000 seconds

    function setUp() public {
        distributor = makeAddr("distributor");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        nonDistributor = makeAddr("nonDistributor");

        // Deploy tokens
        stakingToken = new MockStakingToken();
        rewardToken = new MockRewardToken();

        // Deploy vault from distributor
        vm.prank(distributor);
        vault = new YieldVault(address(stakingToken), address(rewardToken));

        // Distribute staking tokens to users
        stakingToken.transfer(alice, 10_000e18);
        stakingToken.transfer(bob, 10_000e18);
        stakingToken.transfer(carol, 10_000e18);

        // Distribute reward tokens to distributor
        rewardToken.transfer(distributor, 100_000e18);

        // Approve vault for all users
        vm.prank(alice);
        stakingToken.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        stakingToken.approve(address(vault), type(uint256).max);
        vm.prank(carol);
        stakingToken.approve(address(vault), type(uint256).max);
    }

    // ─────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────
    function _notifyReward(uint256 reward, uint256 duration) internal {
        vm.prank(distributor);
        vault.notifyRewardAmount(reward, duration);
    }

    function _deposit(address user, uint256 amount) internal {
        vm.prank(user);
        vault.deposit(amount);
    }

    function _withdraw(address user, uint256 amount) internal {
        vm.prank(user);
        vault.withdraw(amount);
    }

    function _claimReward(address user) internal {
        vm.prank(user);
        vault.claimReward();
    }

    function _setupRewardAndDeposit() internal {
        // Fund vault with reward tokens and notify
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        _notifyReward(REWARD_AMOUNT, DURATION);

        // Alice deposits
        _deposit(alice, 100e18);
    }

    // ═══════════════════════════════════════════
    // CONSTRUCTOR TESTS
    // ═══════════════════════════════════════════

    function test_constructor_setsTokens() public {
        assertEq(address(vault.stakingToken()), address(stakingToken));
        assertEq(address(vault.rewardToken()), address(rewardToken));
        assertEq(vault.rewardDistributor(), distributor);
    }

    // ═══════════════════════════════════════════
    // lastTimeRewardApplicable TESTS
    // ═══════════════════════════════════════════

    function test_lastTimeRewardApplicable_beforePeriodFinish() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        _notifyReward(REWARD_AMOUNT, DURATION);

        // Before period finishes, should return block.timestamp
        assertEq(vault.lastTimeRewardApplicable(), block.timestamp);

        // Warp halfway
        vm.warp(block.timestamp + 500);
        assertEq(vault.lastTimeRewardApplicable(), block.timestamp);
    }

    function test_lastTimeRewardApplicable_afterPeriodFinish() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        _notifyReward(REWARD_AMOUNT, DURATION);

        uint256 finishTime = vault.periodFinish();

        // Warp past period finish
        vm.warp(finishTime + 500);

        // Should be capped at periodFinish, not block.timestamp
        assertEq(vault.lastTimeRewardApplicable(), finishTime);
        assertLt(vault.lastTimeRewardApplicable(), block.timestamp);
    }

    function test_lastTimeRewardApplicable_noRewardPeriod() public {
        // periodFinish is 0 initially, so should return 0 (since block.timestamp > 0)
        assertEq(vault.lastTimeRewardApplicable(), 0);
    }

    // ═══════════════════════════════════════════
    // rewardPerToken TESTS
    // ═══════════════════════════════════════════

    function test_rewardPerToken_noStakers() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        _notifyReward(REWARD_AMOUNT, DURATION);

        vm.warp(block.timestamp + 100);

        // No stakers => rewardPerToken stays 0
        assertEq(vault.rewardPerToken(), 0);
    }

    function test_rewardPerToken_accruesDuringPeriod() public {
        _setupRewardAndDeposit();

        uint256 rptBefore = vault.rewardPerToken();
        vm.warp(block.timestamp + 100);
        uint256 rptAfter = vault.rewardPerToken();

        assertGt(rptAfter, rptBefore);
    }

    function test_rewardPerToken_stopsAtPeriodFinish() public {
        _setupRewardAndDeposit();

        // Warp to period end
        uint256 finishTime = vault.periodFinish();
        vm.warp(finishTime);
        uint256 rptAtEnd = vault.rewardPerToken();

        // Warp far past period end
        vm.warp(finishTime + 1_000_000);
        uint256 rptAfterEnd = vault.rewardPerToken();

        // rewardPerToken should NOT increase after periodFinish
        assertEq(rptAtEnd, rptAfterEnd);
    }

    function test_rewardPerToken_phantomRewardBug_fixed() public {
        // This is the core bug test: before the fix, rewards kept accruing after periodFinish
        _setupRewardAndDeposit();

        uint256 finishTime = vault.periodFinish();

        // Warp to end + extra time
        vm.warp(finishTime + 9999);
        uint256 rptAfter = vault.rewardPerToken();

        // The maximum rewardPerToken should be bounded by the total reward / total supply
        // rewardRate = 1000e18 / 1000 = 1e18 per second
        // Total reward duration = 1000 seconds
        // Max rpt = 1000 * 1e18 * 1e18 / 100e18 = 1000 * 1e18 / 100 = 10e18
        uint256 maxRPT = uint256(DURATION) * vault.rewardRate() * 1e18 / vault.totalSupply();
        assertLe(rptAfter, maxRPT);
    }

    // ═══════════════════════════════════════════
    // earned TESTS
    // ═══════════════════════════════════════════

    function test_earned_duringPeriod() public {
        _setupRewardAndDeposit();

        vm.warp(block.timestamp + 500);

        uint256 earnedAmount = vault.earned(alice);
        assertGt(earnedAmount, 0);
    }

    function test_earned_stopsAtPeriodFinish() public {
        _setupRewardAndDeposit();

        uint256 finishTime = vault.periodFinish();
        vm.warp(finishTime);
        uint256 earnedAtEnd = vault.earned(alice);

        // Warp far past
        vm.warp(finishTime + 1_000_000);
        uint256 earnedAfterEnd = vault.earned(alice);

        // Earned should NOT increase after periodFinish
        assertEq(earnedAtEnd, earnedAfterEnd);
    }

    function test_earned_phantomRewardBug_fixed() public {
        _setupRewardAndDeposit();

        uint256 finishTime = vault.periodFinish();
        vm.warp(finishTime + 1_000_000);
        uint256 earnedAmount = vault.earned(alice);

        // Max possible earnings: totalReward for the whole period
        // Since alice is the only staker, she should earn at most the total reward
        assertLe(earnedAmount, REWARD_AMOUNT);
    }

    // ═══════════════════════════════════════════
    // DEPOSIT TESTS
    // ═══════════════════════════════════════════

    function test_deposit_happyPath() public {
        _deposit(alice, 100e18);

        assertEq(vault.balanceOf(alice), 100e18);
        assertEq(vault.totalSupply(), 100e18);
    }

    function test_deposit_emitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit YieldVault.Deposited(alice, 100e18);
        vault.deposit(100e18);
    }

    function test_deposit_zero_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Cannot deposit 0");
        vault.deposit(0);
    }

    function test_deposit_multipleUsers() public {
        _deposit(alice, 100e18);
        _deposit(bob, 200e18);
        _deposit(carol, 300e18);

        assertEq(vault.totalSupply(), 600e18);
        assertEq(vault.balanceOf(alice), 100e18);
        assertEq(vault.balanceOf(bob), 200e18);
        assertEq(vault.balanceOf(carol), 300e18);
    }

    // ═══════════════════════════════════════════
    // WITHDRAW TESTS
    // ═══════════════════════════════════════════

    function test_withdraw_happyPath() public {
        _deposit(alice, 100e18);
        _withdraw(alice, 50e18);

        assertEq(vault.balanceOf(alice), 50e18);
        assertEq(vault.totalSupply(), 50e18);
    }

    function test_withdraw_emitsEvent() public {
        _deposit(alice, 100e18);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit YieldVault.Withdrawn(alice, 50e18);
        vault.withdraw(50e18);
    }

    function test_withdraw_zero_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Cannot withdraw 0");
        vault.withdraw(0);
    }

    // ═══════════════════════════════════════════
    // CLAIM REWARD TESTS
    // ═══════════════════════════════════════════

    function test_claimReward_duringPeriod() public {
        _setupRewardAndDeposit();
        vm.warp(block.timestamp + 500);

        uint256 earnedAmount = vault.earned(alice);
        _claimReward(alice);

        assertEq(rewardToken.balanceOf(alice), earnedAmount);
    }

    function test_claimReward_atPeriodEnd() public {
        _setupRewardAndDeposit();

        uint256 finishTime = vault.periodFinish();
        vm.warp(finishTime);

        uint256 earnedAmount = vault.earned(alice);
        _claimReward(alice);

        assertEq(rewardToken.balanceOf(alice), earnedAmount);
    }

    function test_claimReward_emitsEvent() public {
        _setupRewardAndDeposit();
        vm.warp(block.timestamp + 100);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit YieldVault.RewardPaid(alice, vault.earned(alice));
        vault.claimReward();
    }

    function test_claimReward_zeroReward() public {
        _deposit(alice, 100e18);
        // No reward period set, so earned should be 0

        vm.prank(alice);
        vault.claimReward(); // Should not revert, just do nothing

        assertEq(rewardToken.balanceOf(alice), 0);
    }

    function test_claimReward_resetsRewards() public {
        _setupRewardAndDeposit();
        vm.warp(block.timestamp + 100);

        _claimReward(alice);
        assertEq(vault.rewards(alice), 0);
    }

    // ═══════════════════════════════════════════
    // PHANTOM REWARD BUG TESTS (CORE FIX)
    // ═══════════════════════════════════════════

    function test_noPhantomRewardsAfterPeriodExpiry() public {
        // Setup: alice deposits, reward period set
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        _notifyReward(REWARD_AMOUNT, DURATION);
        _deposit(alice, 100e18);

        uint256 finishTime = vault.periodFinish();

        // Warp to period end
        vm.warp(finishTime);
        uint256 earnedAtEnd = vault.earned(alice);

        // Warp way past period end
        vm.warp(finishTime + 1_000_000);
        uint256 earnedAfterEnd = vault.earned(alice);

        // KEY ASSERTION: no phantom rewards accrue after expiry
        assertEq(earnedAtEnd, earnedAfterEnd);
    }

    function test_claimAfterPeriodExpiry_matchesActualBalance() public {
        // Setup reward and staker
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        _notifyReward(REWARD_AMOUNT, DURATION);
        _deposit(alice, 100e18);

        uint256 finishTime = vault.periodFinish();

        // Warp way past period end
        vm.warp(finishTime + 1_000_000);

        // Claim should work and give only the real earned amount
        uint256 earnedAmount = vault.earned(alice);
        _claimReward(alice);

        // Alice should get exactly what she earned during the period, not more
        assertEq(rewardToken.balanceOf(alice), earnedAmount);

        // Total claimed should not exceed total notified
        assertLe(vault.totalRewardsClaimed(), vault.totalRewardsNotified());

        // Contract should still have reward tokens remaining (not drained)
        assertGt(rewardToken.balanceOf(address(vault)), 0);
    }

    function test_rewardAccrualCapsAtPeriodFinish_forMultipleStakers() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        _notifyReward(REWARD_AMOUNT, DURATION);

        _deposit(alice, 100e18);
        _deposit(bob, 100e18);

        uint256 finishTime = vault.periodFinish();
        vm.warp(finishTime + 1_000_000);

        // Both should have earned rewards capped at period end
        uint256 aliceEarned = vault.earned(alice);
        uint256 bobEarned = vault.earned(bob);

        // Combined earnings should not exceed total reward
        assertLe(aliceEarned + bobEarned, REWARD_AMOUNT);
    }

    function test_phantomRewardsDoNotDrainContract() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        _notifyReward(REWARD_AMOUNT, DURATION);
        _deposit(alice, 100e18);

        uint256 finishTime = vault.periodFinish();

        // Warp far past period
        vm.warp(finishTime + 1_000_000);

        // Record contract balance before claims
        uint256 contractRewardBalance = rewardToken.balanceOf(address(vault));

        // Alice claims
        _claimReward(alice);

        // Contract should not have transferred more than it had allocated
        uint256 aliceClaimed = rewardToken.balanceOf(alice);
        assertLe(aliceClaimed, REWARD_AMOUNT);

        // Contract should still have remaining rewards (if any from rounding or safety margin)
        assertLe(vault.totalRewardsClaimed(), vault.totalRewardsNotified());
    }

    function test_lastUpdateTime_cappedAtPeriodFinish() public {
        _setupRewardAndDeposit();

        uint256 finishTime = vault.periodFinish();

        // Trigger an update far past the period
        vm.warp(finishTime + 5000);
        _claimReward(alice); // triggers updateReward

        // lastUpdateTime should be capped at periodFinish, not block.timestamp
        assertEq(vault.lastUpdateTime(), finishTime);
        assertLt(vault.lastUpdateTime(), block.timestamp);
    }

    // ═══════════════════════════════════════════
    // notifyRewardAmount ACCESS CONTROL TESTS
    // ═══════════════════════════════════════════

    function test_notifyRewardAmount_onlyDistributor() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);

        vm.prank(nonDistributor);
        vm.expectRevert("Not reward distributor");
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);
    }

    function test_notifyRewardAmount_happyPath() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);

        vm.prank(distributor);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        assertEq(vault.rewardRate(), REWARD_AMOUNT / DURATION);
        assertEq(vault.periodFinish(), block.timestamp + DURATION);
        assertEq(vault.totalRewardsNotified(), REWARD_AMOUNT);
    }

    function test_notifyRewardAmount_emitsEvent() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);

        vm.prank(distributor);
        vm.expectEmit(false, false, false, true);
        emit YieldVault.RewardNotified(REWARD_AMOUNT, DURATION, REWARD_AMOUNT / DURATION);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);
    }

    function test_notifyRewardAmount_zeroDuration_reverts() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);

        vm.prank(distributor);
        vm.expectRevert("Duration must be > 0");
        vault.notifyRewardAmount(REWARD_AMOUNT, 0);
    }

    function test_notifyRewardAmount_zeroReward_reverts() public {
        vm.prank(distributor);
        vm.expectRevert("Reward must be > 0");
        vault.notifyRewardAmount(0, DURATION);
    }

    // ═══════════════════════════════════════════
    // REWARD ACCOUNTING TESTS
    // ═══════════════════════════════════════════

    function test_totalRewardsNotified_tracksMultipleNotifications() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT * 2);

        vm.prank(distributor);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);
        assertEq(vault.totalRewardsNotified(), REWARD_AMOUNT);

        // After first period ends, notify again
        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(distributor);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);
        assertEq(vault.totalRewardsNotified(), REWARD_AMOUNT * 2);
    }

    function test_totalRewardsClaimed_tracksClaims() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        _notifyReward(REWARD_AMOUNT, DURATION);
        _deposit(alice, 100e18);

        vm.warp(block.timestamp + 500);

        uint256 beforeClaim = vault.totalRewardsClaimed();
        _claimReward(alice);
        uint256 afterClaim = vault.totalRewardsClaimed();

        assertGt(afterClaim, beforeClaim);
    }

    // ═══════════════════════════════════════════
    // FULL SCENARIO / INTEGRATION TESTS
    // ═══════════════════════════════════════════

    function test_fullScenario_depositEarnClaim_noPhantomRewards() public {
        // 1. Notify reward
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        _notifyReward(REWARD_AMOUNT, DURATION);

        // 2. Alice deposits
        _deposit(alice, 100e18);

        // 3. Time passes (within period)
        vm.warp(block.timestamp + 500);

        // 4. Alice earns rewards during period
        uint256 aliceEarnedMid = vault.earned(alice);
        assertGt(aliceEarnedMid, 0);

        // 5. Period ends
        vm.warp(block.timestamp + DURATION); // total warp = 1500, but period is only 1000

        // 6. Alice claims after period end
        uint256 aliceEarnedEnd = vault.earned(alice);
        _claimReward(alice);

        // 7. No phantom rewards: earned at end should be reasonable
        assertLe(aliceEarnedEnd, REWARD_AMOUNT);
        assertEq(rewardToken.balanceOf(alice), aliceEarnedEnd);

        // 8. Warp further and verify no more accrual
        vm.warp(block.timestamp + 1_000_000);
        assertEq(vault.earned(alice), 0); // Already claimed, should be 0
    }

    function test_fullScenario_multipleStakers_proportionalRewards() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        _notifyReward(REWARD_AMOUNT, DURATION);

        _deposit(alice, 100e18);
        _deposit(bob, 300e18);

        // Warp to period end
        uint256 finishTime = vault.periodFinish();
        vm.warp(finishTime);

        uint256 aliceEarned = vault.earned(alice);
        uint256 bobEarned = vault.earned(bob);

        // Bob has 3x the stake, should earn ~3x the rewards
        // Due to rounding, use approximate check
        assertApproxEqAbs(bobEarned, aliceEarned * 3, 1e15);

        // Combined should not exceed total reward
        assertLe(aliceEarned + bobEarned, REWARD_AMOUNT);
    }

    function test_depositMidPeriod_updatesRewardCorrectly() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        _notifyReward(REWARD_AMOUNT, DURATION);

        // Alice deposits at start
        _deposit(alice, 100e18);

        // Bob deposits halfway through
        vm.warp(block.timestamp + 500);
        _deposit(bob, 100e18);

        // Warp to end
        uint256 finishTime = vault.periodFinish();
        vm.warp(finishTime);

        // Alice earned more (she was staking from the beginning)
        uint256 aliceEarned = vault.earned(alice);
        uint256 bobEarned = vault.earned(bob);
        assertGt(aliceEarned, bobEarned);
    }

    function test_withdrawMidPeriod_stopsRewardAccrual() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        _notifyReward(REWARD_AMOUNT, DURATION);

        _deposit(alice, 100e18);

        // Warp halfway, then withdraw
        vm.warp(block.timestamp + 500);
        _withdraw(alice, 100e18);

        uint256 earnedAtWithdraw = vault.earned(alice);

        // Warp to end
        uint256 finishTime = vault.periodFinish();
        vm.warp(finishTime);

        // Alice's earned should not have grown after withdrawal (balance is 0)
        uint256 earnedAfterPeriod = vault.earned(alice);
        assertEq(earnedAtWithdraw, earnedAfterPeriod);
    }

    function test_reNotifyAfterPeriodEnd_resetsCorrectly() public {
        vm.prank(distributor);
        rewardToken.transfer(address(vault), REWARD_AMOUNT * 2);
        _notifyReward(REWARD_AMOUNT, DURATION);
        _deposit(alice, 100e18);

        // Warp past first period
        vm.warp(block.timestamp + DURATION + 1);

        // Notify a second reward period
        vm.prank(distributor);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        // Alice should start earning from the new period
        uint256 earnedBefore = vault.earned(alice);
        vm.warp(block.timestamp + 500);
        uint256 earnedAfter = vault.earned(alice);

        assertGt(earnedAfter, earnedBefore);
    }
}
