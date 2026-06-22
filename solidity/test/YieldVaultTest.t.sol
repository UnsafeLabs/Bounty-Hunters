// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/YieldVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1e30);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract YieldVaultTest is Test {
    YieldVault public vault;
    MockToken public stakingToken;
    MockToken public rewardToken;
    address public distributor = address(this);
    address public user1 = address(0x1);
    address public user2 = address(0x2);
    address public unauthorized = address(0x3);

    uint256 constant DURATION = 7 days;
    uint256 constant REWARD_AMOUNT = 1000 ether;

    function setUp() public {
        stakingToken = new MockToken("Staking", "STK");
        rewardToken = new MockToken("Reward", "RWD");
        vault = new YieldVault(address(stakingToken), address(rewardToken));

        // Fund vault and set up reward
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        // Give users staking tokens
        stakingToken.mint(user1, 1000 ether);
        stakingToken.mint(user2, 1000 ether);

        vm.prank(user1);
        stakingToken.approve(address(vault), type(uint256).max);
        vm.prank(user2);
        stakingToken.approve(address(vault), type(uint256).max);
    }

    // Test: reward accrual during period
    function test_rewardAccrualDuringPeriod() public {
        vm.prank(user1);
        vault.deposit(100 ether);

        // Advance time by 1 day
        vm.warp(block.timestamp + 1 days);

        uint256 earned = vault.earned(user1);
        assertGt(earned, 0, "Should accrue rewards during period");

        // Advance another day
        vm.warp(block.timestamp + 1 days);
        uint256 earned2 = vault.earned(user1);
        assertGt(earned2, earned, "Rewards should continue accruing");
    }

    // Test: no phantom rewards after period ends
    function test_noPhantomRewardsAfterPeriodExpiry() public {
        vm.prank(user1);
        vault.deposit(100 ether);

        // Advance past the reward period
        vm.warp(block.timestamp + DURATION + 1);

        uint256 earnedAtEnd = vault.earned(user1);
        assertGt(earnedAtEnd, 0, "Should have earned rewards");

        // Advance more time — earned should NOT increase
        vm.warp(block.timestamp + 7 days);
        uint256 earnedAfterExpiry = vault.earned(user1);

        assertEq(earnedAtEnd, earnedAfterExpiry, "No phantom rewards should accrue after period ends");
    }

    // Test: late deposit after period starts gets no rewards
    function test_lateDepositGetsNoExtraRewards() public {
        vm.prank(user1);
        vault.deposit(100 ether);

        // Advance past the reward period
        vm.warp(block.timestamp + DURATION + 1);

        // New user deposits after period ended
        vm.prank(user2);
        vault.deposit(100 ether);

        vm.warp(block.timestamp + 7 days);

        uint256 earned2 = vault.earned(user2);
        assertEq(earned2, 0, "Late depositor should get zero rewards");
    }

    // Test: unauthorized notifyRewardAmount
    function test_unauthorizedNotifyRewardAmount() public {
        vm.prank(unauthorized);
        vm.expectRevert("Not authorized");
        vault.notifyRewardAmount(500 ether, DURATION);
    }

    // Test: authorized notifyRewardAmount
    function test_authorizedNotifyRewardAmount() public {
        // distributor (address(this)) should succeed
        vault.notifyRewardAmount(500 ether, DURATION);
        assertEq(vault.rewardRate(), 500 ether * 1e18 / DURATION);
    }

    // Test: precision verification
    function test_precisionLoss() public {
        // Small reward over long duration
        uint256 smallReward = 100; // 100 wei
        uint256 longDuration = 365 days;

        vault.notifyRewardAmount(smallReward, longDuration);
        uint256 rate = vault.rewardRate();

        // rate = 100 * 1e18 / 31536000 = ~3170979198 wei per second (scaled)
        assertGt(rate, 0, "Reward rate should be non-zero even for small amounts");

        // Verify that over full duration, total rewards approximate the input
        // total = rate * duration / 1e18
        uint256 totalReward = rate * longDuration / 1e18;
        // Should be close to 100 (within 1 unit)
        assertGe(totalReward, 99, "Total reward should be at least 99");
        assertLe(totalReward, 100, "Total reward should be at most 100");
    }

    // Test: deposit and withdraw still work
    function test_depositWithdrawFlow() public {
        vm.startPrank(user1);
        vault.deposit(100 ether);
        assertEq(vault.balanceOf(user1), 100 ether);

        vm.warp(block.timestamp + 1 days);

        vault.withdraw(50 ether);
        assertEq(vault.balanceOf(user1), 50 ether);
        vm.stopPrank();
    }

    // Test: claim reward flow
    function test_claimReward() public {
        vm.prank(user1);
        vault.deposit(100 ether);

        vm.warp(block.timestamp + 1 days);

        uint256 earnedBefore = vault.earned(user1);
        assertGt(earnedBefore, 0);

        uint256 balBefore = rewardToken.balanceOf(user1);
        vm.prank(user1);
        vault.claimReward();
        uint256 balAfter = rewardToken.balanceOf(user1);

        assertGt(balAfter - balBefore, 0, "Should receive reward tokens");
    }

    // Test: rewardPerToken caps at periodFinish
    function test_rewardPerTokenCapsAtPeriodFinish() public {
        vm.prank(user1);
        vault.deposit(100 ether);

        uint256 finishTime = vault.periodFinish();

        // Check at exact period finish
        vm.warp(finishTime);
        uint256 rptAtFinish = vault.rewardPerToken();

        // Check well after period finish
        vm.warp(finishTime + 100 days);
        uint256 rptAfterFinish = vault.rewardPerToken();

        assertEq(rptAtFinish, rptAfterFinish, "rewardPerToken should be identical at and after period finish");
    }
}
