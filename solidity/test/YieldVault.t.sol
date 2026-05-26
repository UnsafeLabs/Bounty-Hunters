// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/YieldVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {
        _mint(msg.sender, 10000000 * 10**18);
    }
}

contract YieldVaultTest is Test {
    YieldVault vault;
    MockToken stakingToken;
    MockToken rewardToken;
    address user1;
    address user2;

    function setUp() public {
        stakingToken = new MockToken();
        rewardToken = new MockToken();
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");

        vault = new YieldVault(address(stakingToken), address(rewardToken));

        // Fund users
        stakingToken.transfer(user1, 100000 * 10**18);
        stakingToken.transfer(user2, 100000 * 10**18);
        rewardToken.transfer(address(vault), 1000000 * 10**18);

        // Approve
        vm.prank(user1);
        stakingToken.approve(address(vault), type(uint256).max);
        vm.prank(user2);
        stakingToken.approve(address(vault), type(uint256).max);
    }

    function test_RewardAccrualDuringPeriod() public {
        vault.notifyRewardAmount(1000 * 10**18, 100);
        vault.deposit(1000 * 10**18);

        // Advance time halfway through the period
        vm.warp(block.timestamp + 50);

        uint256 earned1 = vault.earned(user1);
        assertGt(earned1, 0, "Should have earned rewards during period");
    }

    function test_RewardFreezeAfterPeriod() public {
        vault.notifyRewardAmount(1000 * 10**18, 100);
        vault.deposit(1000 * 10**18);

        // Advance past the reward period
        vm.warp(block.timestamp + 150);

        uint256 earnedAfterPeriod = vault.earned(user1);

        // Advance more time — rewards should not increase
        vm.warp(block.timestamp + 100);

        uint256 earnedLater = vault.earned(user1);
        assertEq(earnedAfterPeriod, earnedLater, "Rewards should not accrue after period ends");
    }

    function test_UnauthorizedNotifyRewardAmount() public {
        vm.prank(user1);
        try vault.notifyRewardAmount(1000 * 10**18, 100) {
            revert("Should have reverted");
        } catch (bytes memory reason) {
            // Expected: only distributor can call
            assertTrue(true);
        }
    }

    function test_AuthorizedDistributorCanNotify() public {
        // deployer is the initial distributor
        vault.notifyRewardAmount(1000 * 10**18, 100);
        // No revert means success
        assertTrue(true);
    }

    function test_PrecisionVerification() public {
        // Test with values that would cause precision loss
        uint256 reward = 1000 * 10**18;
        uint256 duration = 100;
        vault.notifyRewardAmount(reward, duration);
        vault.deposit(1000 * 10**18);

        // Advance through full period
        vm.warp(block.timestamp + duration);

        uint256 earnedAmount = vault.earned(user1);
        // Should be close to 1000 * 10**18 (within 0.01%)
        uint256 expected = reward;
        uint256 tolerance = expected / 10000; // 0.01%
        assertApproxEqAbs(earnedAmount, expected, 0, "Precision loss should be minimal");
    }

    function test_DepositAfterPeriod() public {
        vault.notifyRewardAmount(1000 * 10**18, 100);

        // Let period expire
        vm.warp(block.timestamp + 150);

        // New deposit should not accrue phantom rewards
        uint256 earnedBefore = vault.earned(user1);
        vault.deposit(500 * 10**18);
        uint256 earnedAfter = vault.earned(user1);

        // earned should not change just from depositing after period
        assertEq(earnedBefore, earnedAfter, "No phantom rewards for post-period deposit");
    }

    function test_WithdrawAndClaimFlow() public {
        vault.notifyRewardAmount(1000 * 10**18, 100);
        vault.deposit(1000 * 10**18);

        vm.warp(block.timestamp + 100);

        uint256 rewardBefore = vault.earned(user1);
        assertGt(rewardBefore, 0);

        vault.claimReward();
        uint256 rewardAfterClaim = vault.rewards(user1);
        assertEq(rewardAfterClaim, 0, "Rewards should be zero after claim");
    }

    function test_SetRewardDistributor() public {
        address newDistributor = makeAddr("newDistributor");
        vault.setRewardDistributor(newDistributor);

        // New distributor should be able to call notifyRewardAmount
        vm.prank(newDistributor);
        vault.notifyRewardAmount(500 * 10**18, 50);

        // Old distributor should not
        try vault.notifyRewardAmount(500 * 10**18, 50) {
            revert("Old distributor should not be authorized");
        } catch {
            assertTrue(true);
        }
    }

    function test_ExistingDepositWithdrawFunction() public {
        vault.deposit(1000 * 10**18);
        assertEq(vault.balanceOf(user1), 1000 * 10**18);

        vault.withdraw(500 * 10**18);
        assertEq(vault.balanceOf(user1), 500 * 10**18);
    }
}
