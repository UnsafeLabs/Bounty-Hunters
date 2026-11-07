// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/YieldVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol, uint256 initialSupply) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }
}

contract YieldVaultTest is Test {
    YieldVault public vault;
    MockToken public stakingToken;
    MockToken public rewardToken;
    address public distributor;
    address public user1;
    address public user2;
    address public unauthorized;

    function setUp() public {
        distributor = address(this);
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        unauthorized = makeAddr("unauthorized");

        stakingToken = new MockToken("Staking Token", "STK", 1000000 * 1e18);
        rewardToken = new MockToken("Reward Token", "RWD", 1000000 * 1e18);

        vault = new YieldVault(address(stakingToken), address(rewardToken));

        // Distribute tokens
        stakingToken.transfer(user1, 100000 * 1e18);
        stakingToken.transfer(user2, 100000 * 1e18);
        rewardToken.transfer(address(vault), 100000 * 1e18); // Fund vault with rewards

        // Approve vault
        vm.prank(user1);
        stakingToken.approve(address(vault), type(uint256).max);
        vm.prank(user2);
        stakingToken.approve(address(vault), type(uint256).max);
    }

    function test_InitialState() public view {
        assertEq(vault.stakingToken(), address(stakingToken));
        assertEq(vault.rewardToken(), address(rewardToken));
        assertEq(vault.rewardDistributor(), distributor);
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.rewardRate(), 0);
    }

    function test_Deposit() public {
        uint256 depositAmount = 10000 * 1e18;
        
        vm.prank(user1);
        vault.deposit(depositAmount);

        assertEq(vault.balanceOf(user1), depositAmount);
        assertEq(vault.totalSupply(), depositAmount);
        assertEq(stakingToken.balanceOf(address(vault)), depositAmount);
    }

    function test_DepositZero() public {
        vm.prank(user1);
        vm.expectRevert("Cannot deposit 0");
        vault.deposit(0);
    }

    function test_Withdraw() public {
        uint256 depositAmount = 10000 * 1e18;
        
        vm.prank(user1);
        vault.deposit(depositAmount);

        vm.prank(user1);
        vault.withdraw(depositAmount);

        assertEq(vault.balanceOf(user1), 0);
        assertEq(vault.totalSupply(), 0);
        assertEq(stakingToken.balanceOf(user1), 100000 * 1e18);
    }

    function test_WithdrawInsufficientBalance() public {
        vm.prank(user1);
        vm.expectRevert("Insufficient balance");
        vault.withdraw(1000);
    }

    function test_NotifyRewardAmountAccessControl() public {
        vm.prank(unauthorized);
        vm.expectRevert("Not authorized");
        vault.notifyRewardAmount(10000 * 1e18, 7 days);
    }

    function test_NotifyRewardAmount() public {
        uint256 reward = 10000 * 1e18;
        uint256 duration = 7 days;

        vault.notifyRewardAmount(reward, duration);

        // rewardRate should be reward * 1e18 / duration
        uint256 expectedRate = reward * 1e18 / duration;
        assertEq(vault.rewardRate(), expectedRate);
        assertEq(vault.periodFinish(), block.timestamp + duration);
    }

    function test_NotifyRewardAmountZeroDuration() public {
        vm.expectRevert("Duration must be > 0");
        vault.notifyRewardAmount(10000 * 1e18, 0);
    }

    function test_NotifyRewardAmountZeroReward() public {
        vm.expectRevert("Reward must be > 0");
        vault.notifyRewardAmount(0, 7 days);
    }

    function test_RewardAccrualDuringPeriod() public {
        // Setup: deposit and notify rewards
        vm.prank(user1);
        vault.deposit(10000 * 1e18);

        uint256 reward = 7000 * 1e18; // 1000 per day
        uint256 duration = 7 days;
        vault.notifyRewardAmount(reward, duration);

        // Warp 1 day
        vm.warp(block.timestamp + 1 days);

        // Check earned rewards
        uint256 earned = vault.earned(user1);
        // Should be approximately 1000 tokens (with precision)
        assertApproxEqRel(earned, 1000 * 1e18, 0.01e18); // 1% tolerance
    }

    function test_RewardFreezeAfterPeriod() public {
        // Setup
        vm.prank(user1);
        vault.deposit(10000 * 1e18);

        uint256 reward = 7000 * 1e18;
        uint256 duration = 7 days;
        vault.notifyRewardAmount(reward, duration);

        // Warp past period end
        vm.warp(block.timestamp + duration + 1 days);

        uint256 earnedAfterPeriod = vault.earned(user1);

        // Warp more time
        vm.warp(block.timestamp + 10 days);

        uint256 earnedLater = vault.earned(user1);

        // Earned should not increase after period ends (no phantom rewards)
        assertEq(earnedAfterPeriod, earnedLater);
    }

    function test_NoPhantomRewardsAfterPeriod() public {
        vm.prank(user1);
        vault.deposit(10000 * 1e18);

        uint256 reward = 7000 * 1e18;
        uint256 duration = 7 days;
        vault.notifyRewardAmount(reward, duration);

        // Warp to exactly period end
        vm.warp(block.timestamp + duration);

        uint256 earnedAtEnd = vault.earned(user1);

        // Should be approximately 7000 tokens
        assertApproxEqRel(earnedAtEnd, 7000 * 1e18, 0.01e18);

        // Warp far into future
        vm.warp(block.timestamp + 365 days);

        uint256 earnedAfter = vault.earned(user1);

        // Should not have increased (no phantom rewards)
        assertEq(earnedAtEnd, earnedAfter);
    }

    function test_ClaimReward() public {
        vm.prank(user1);
        vault.deposit(10000 * 1e18);

        uint256 reward = 7000 * 1e18;
        vault.notifyRewardAmount(reward, 7 days);

        vm.warp(block.timestamp + 7 days);

        uint256 earned = vault.earned(user1);
        
        vm.prank(user1);
        vault.claimReward();

        assertEq(rewardToken.balanceOf(user1), earned);
        assertEq(vault.rewards(user1), 0);
    }

    function test_MultipleDepositors() public {
        vm.prank(user1);
        vault.deposit(10000 * 1e18);

        vm.prank(user2);
        vault.deposit(10000 * 1e18);

        uint256 reward = 7000 * 1e18;
        vault.notifyRewardAmount(reward, 7 days);

        vm.warp(block.timestamp + 7 days);

        uint256 earned1 = vault.earned(user1);
        uint256 earned2 = vault.earned(user2);

        // Both should earn approximately equal amounts
        assertApproxEqRel(earned1, earned2, 0.01e18);
        assertApproxEqRel(earned1, 3500 * 1e18, 0.01e18);
    }

    function test_PrecisionVerification() public {
        uint256 reward = 1000000 * 1e18;
        uint256 duration = 30 days;

        vault.notifyRewardAmount(reward, duration);

        uint256 rewardRate = vault.rewardRate();
        uint256 expectedRate = reward * 1e18 / duration;

        assertEq(rewardRate, expectedRate);

        // Verify precision: calculate total rewards over duration
        uint256 totalRewards = rewardRate * duration / 1e18;
        
        // Should be very close to original reward (< 0.01% error)
        uint256 error = reward > totalRewards ? reward - totalRewards : totalRewards - reward;
        uint256 errorPercent = error * 10000 / reward;
        assertLt(errorPercent, 1); // < 0.01% error
    }

    function test_RewardPerTokenCappedAtPeriodFinish() public {
        vm.prank(user1);
        vault.deposit(10000 * 1e18);

        uint256 reward = 7000 * 1e18;
        uint256 duration = 7 days;
        vault.notifyRewardAmount(reward, duration);

        // Warp to period end
        vm.warp(block.timestamp + duration);

        uint256 rewardPerTokenAtEnd = vault.rewardPerToken();

        // Warp far into future
        vm.warp(block.timestamp + 365 days);

        uint256 rewardPerTokenAfter = vault.rewardPerToken();

        // Should be the same (capped at period end)
        assertEq(rewardPerTokenAtEnd, rewardPerTokenAfter);
    }

    function test_SetRewardDistributor() public {
        address newDistributor = makeAddr("newDistributor");
        
        vault.setRewardDistributor(newDistributor);
        assertEq(vault.rewardDistributor(), newDistributor);

        // Old distributor can no longer call
        vm.expectRevert("Not authorized");
        vault.notifyRewardAmount(1000 * 1e18, 1 days);

        // New distributor can call
        vm.prank(newDistributor);
        vault.notifyRewardAmount(1000 * 1e18, 1 days);
    }

    function test_SetRewardDistributorAccessControl() public {
        vm.prank(unauthorized);
        vm.expectRevert("Not authorized");
        vault.setRewardDistributor(unauthorized);
    }

    function test_SetRewardDistributorZeroAddress() public {
        vm.expectRevert("Invalid address");
        vault.setRewardDistributor(address(0));
    }

    function test_InvalidConstructorAddresses() public {
        vm.expectRevert("Invalid addresses");
        new YieldVault(address(0), address(rewardToken));

        vm.expectRevert("Invalid addresses");
        new YieldVault(address(stakingToken), address(0));
    }

    function test_DepositAfterPeriodEnd() public {
        // Setup period
        uint256 reward = 7000 * 1e18;
        vault.notifyRewardAmount(reward, 7 days);

        // Warp past period end
        vm.warp(block.timestamp + 10 days);

        // Deposit after period end
        vm.prank(user1);
        vault.deposit(10000 * 1e18);

        // Should not earn any rewards (period already ended)
        vm.warp(block.timestamp + 1 days);
        assertEq(vault.earned(user1), 0);
    }
}
