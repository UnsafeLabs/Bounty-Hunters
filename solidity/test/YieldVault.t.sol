// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/YieldVault.sol";

// ─────────────────────────────────────────────
// Mock ERC20 for testing
// ─────────────────────────────────────────────
contract MockERC20 is IERC20 {
    string public name = "Mock";
    string public symbol = "MCK";
    uint8 public decimals = 18;
    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "ERC20: insufficient allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract YieldVaultTest is Test {
    YieldVault public vault;
    MockERC20 public stakingToken;
    MockERC20 public rewardToken;

    address public owner;
    address public alice;
    address public bob;
    address public nonDistributor;

    uint256 constant REWARD_AMOUNT = 1000e18;
    uint256 constant DURATION = 7 days;

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        nonDistributor = makeAddr("nonDistributor");

        vm.startPrank(owner);
        stakingToken = new MockERC20();
        rewardToken = new MockERC20();
        vault = new YieldVault(address(stakingToken), address(rewardToken));

        // Fund vault with reward tokens
        rewardToken.mint(address(vault), 100_000e18);

        // Fund users with staking tokens
        vm.stopPrank();

        stakingToken.mint(alice, 10_000e18);
        stakingToken.mint(bob, 10_000e18);

        // Approve vault for users
        vm.prank(alice);
        stakingToken.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        stakingToken.approve(address(vault), type(uint256).max);
    }

    // ─────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────

    function _startRewardPeriod() internal {
        vm.prank(owner);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);
    }

    function _deposit(address user, uint256 amount) internal {
        vm.prank(user);
        vault.deposit(amount);
    }

    // ═══════════════════════════════════════════
    // REWARD ACCRUAL DURING PERIOD
    // ═══════════════════════════════════════════

    function test_rewardAccrual_duringPeriod() public {
        _deposit(alice, 1000e18);
        _startRewardPeriod();

        // Advance half the duration
        vm.warp(block.timestamp + DURATION / 2);

        uint256 earnedAmount = vault.earned(alice);
        uint256 expectedHalf = REWARD_AMOUNT / 2;

        // Allow 1% tolerance for division rounding
        assertApproxEqAbs(earnedAmount, expectedHalf, expectedHalf / 100);
    }

    function test_rewardPerToken_increasesDuringPeriod() public {
        _deposit(alice, 1000e18);
        _startRewardPeriod();

        uint256 rptStart = vault.rewardPerToken();

        vm.warp(block.timestamp + DURATION / 2);

        uint256 rptMid = vault.rewardPerToken();
        assertGt(rptMid, rptStart);
    }

    function test_earned_increasesOverTimeDuringPeriod() public {
        _deposit(alice, 1000e18);
        _startRewardPeriod();

        vm.warp(block.timestamp + 1 days);
        uint256 earned1 = vault.earned(alice);

        vm.warp(block.timestamp + 1 days);
        uint256 earned2 = vault.earned(alice);

        assertGt(earned2, earned1);
    }

    // ═══════════════════════════════════════════
    // REWARD FREEZE AFTER PERIOD
    // ═══════════════════════════════════════════

    function test_rewardFreeze_afterPeriodEnds() public {
        _deposit(alice, 1000e18);
        _startRewardPeriod();

        // Warp past period finish
        vm.warp(block.timestamp + DURATION + 1 days);

        uint256 earnedAtExpiry = vault.earned(alice);

        // Warp further — no additional rewards should accrue
        vm.warp(block.timestamp + 365 days);

        uint256 earnedAfter = vault.earned(alice);

        assertEq(earnedAtExpiry, earnedAfter, "Phantom rewards accrued after period ended");
    }

    function test_rewardPerToken_cappedAtPeriodFinish() public {
        _deposit(alice, 1000e18);
        _startRewardPeriod();

        vm.warp(block.timestamp + DURATION);
        uint256 rptAtEnd = vault.rewardPerToken();

        vm.warp(block.timestamp + 365 days);
        uint256 rptAfter = vault.rewardPerToken();

        assertEq(rptAtEnd, rptAfter, "rewardPerToken should not increase after periodFinish");
    }

    function test_lastTimeRewardApplicable_cappedAtPeriodFinish() public {
        _startRewardPeriod();

        // During period
        uint256 applicableDuring = vault.lastTimeRewardApplicable();
        assertEq(applicableDuring, block.timestamp);

        // After period
        vm.warp(block.timestamp + DURATION + 1 days);
        uint256 applicableAfter = vault.lastTimeRewardApplicable();
        assertEq(applicableAfter, vault.periodFinish());
    }

    function test_earned_zeroAdditionalAfterExpiry() public {
        _deposit(alice, 1000e18);
        _startRewardPeriod();

        // Warp exactly to period finish
        vm.warp(block.timestamp + DURATION);
        uint256 earnedAtEnd = vault.earned(alice);

        // Warp further
        vm.warp(block.timestamp + 100 days);

        // earned should be exactly the same — no additional reward
        uint256 earnedLater = vault.earned(alice);
        assertEq(earnedLater, earnedAtEnd);
    }

    // ═══════════════════════════════════════════
    // ACCESS CONTROL — notifyRewardAmount
    // ═══════════════════════════════════════════

    function test_notifyRewardAmount_unauthorized_reverts() public {
        vm.prank(nonDistributor);
        vm.expectRevert("Not reward distributor");
        vault.notifyRewardAmount(1000e18, 7 days);
    }

    function test_notifyRewardAmount_authorized_succeeds() public {
        vm.prank(owner);
        vault.notifyRewardAmount(1000e18, 7 days);
        assertGt(vault.rewardRate(), 0);
    }

    function test_notifyRewardAmount_aliceCannotCall() public {
        vm.prank(alice);
        vm.expectRevert("Not reward distributor");
        vault.notifyRewardAmount(1000e18, 7 days);
    }

    function test_notifyRewardAmount_zeroDuration_reverts() public {
        vm.prank(owner);
        vm.expectRevert("Duration cannot be zero");
        vault.notifyRewardAmount(1000e18, 0);
    }

    function test_notifyRewardAmount_zeroReward_reverts() public {
        vm.prank(owner);
        vm.expectRevert("Reward cannot be zero");
        vault.notifyRewardAmount(0, 7 days);
    }

    // ═══════════════════════════════════════════
    // PRECISION VERIFICATION
    // ═══════════════════════════════════════════

    function test_precisionLoss_withinTolerance() public {
        _deposit(alice, 1000e18);
        _startRewardPeriod();

        // Warp to period end
        vm.warp(block.timestamp + DURATION);

        uint256 earnedAmount = vault.earned(alice);

        // Error should be less than 0.01% (1 basis point)
        uint256 errorBps = 0;
        if (earnedAmount > REWARD_AMOUNT) {
            errorBps = ((earnedAmount - REWARD_AMOUNT) * 10000) / REWARD_AMOUNT;
        } else {
            errorBps = ((REWARD_AMOUNT - earnedAmount) * 10000) / REWARD_AMOUNT;
        }

        assertLt(errorBps, 1, "Precision loss exceeds 0.01%");
    }

    function test_precision_smallRewardAmount() public {
        // Test with a reward amount that causes maximum rounding loss
        uint256 smallReward = 1e18; // 1 token
        uint256 shortDuration = 1 days;

        _deposit(alice, 100e18);

        vm.prank(owner);
        vault.notifyRewardAmount(smallReward, shortDuration);

        vm.warp(block.timestamp + shortDuration);

        uint256 earnedAmount = vault.earned(alice);

        // Verify error is within 0.01% (1 bps)
        uint256 errorBps = 0;
        if (earnedAmount > smallReward) {
            errorBps = ((earnedAmount - smallReward) * 10000) / smallReward;
        } else {
            errorBps = ((smallReward - earnedAmount) * 10000) / smallReward;
        }

        assertLt(errorBps, 1, "Precision loss exceeds 0.01% for small reward");
    }

    // ═══════════════════════════════════════════
    // EXISTING FLOWS STILL FUNCTION
    // ═══════════════════════════════════════════

    function test_deposit_succeeds() public {
        vm.prank(alice);
        vault.deposit(100e18);
        assertEq(vault.balanceOf(alice), 100e18);
        assertEq(vault.totalSupply(), 100e18);
    }

    function test_withdraw_succeeds() public {
        _deposit(alice, 100e18);
        vm.prank(alice);
        vault.withdraw(50e18);
        assertEq(vault.balanceOf(alice), 50e18);
        assertEq(vault.totalSupply(), 50e18);
    }

    function test_claimReward_succeeds() public {
        _deposit(alice, 1000e18);
        _startRewardPeriod();

        vm.warp(block.timestamp + DURATION / 2);

        vm.prank(alice);
        vault.claimReward();

        assertGt(rewardToken.balanceOf(alice), 0);
        assertEq(vault.rewards(alice), 0);
    }

    function test_fullWorkflow_depositAccrueClaim() public {
        _deposit(alice, 1000e18);
        _startRewardPeriod();

        // Advance time
        vm.warp(block.timestamp + DURATION);

        // Alice claims her reward
        uint256 aliceBalBefore = rewardToken.balanceOf(alice);
        vm.prank(alice);
        vault.claimReward();
        uint256 aliceReward = rewardToken.balanceOf(alice) - aliceBalBefore;

        // Reward should be approximately REWARD_AMOUNT (alice is sole staker)
        assertApproxEqAbs(aliceReward, REWARD_AMOUNT, REWARD_AMOUNT / 100);

        // Alice can withdraw her deposit
        vm.prank(alice);
        vault.withdraw(1000e18);
        assertEq(vault.balanceOf(alice), 0);
    }

    function test_multipleStakers_rewardsProportional() public {
        _deposit(alice, 3000e18);
        _deposit(bob, 7000e18);
        _startRewardPeriod();

        vm.warp(block.timestamp + DURATION);

        uint256 aliceEarned = vault.earned(alice);
        uint256 bobEarned = vault.earned(bob);

        // Alice should get ~30% and Bob ~70%
        // Check ratios with tolerance for rounding
        uint256 totalEarned = aliceEarned + bobEarned;
        assertApproxEqAbs(aliceEarned * 100 / totalEarned, 30, 1);
        assertApproxEqAbs(bobEarned * 100 / totalEarned, 70, 1);
    }

    function test_deposit_zero_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Cannot deposit 0");
        vault.deposit(0);
    }

    function test_withdraw_zero_reverts() public {
        _deposit(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert("Cannot withdraw 0");
        vault.withdraw(0);
    }
}
