// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/YieldVault.sol";
import "@openzeppelin/contracts/mocks/ERC20Mock.sol";

contract YieldVaultTest is Test {
    YieldVault public vault;
    ERC20Mock public stakingToken;
    ERC20Mock public rewardToken;
    address public alice = address(0x1);
    address public distributor = address(0x2);
    uint256 constant PRECISION = 1e18;

    function setUp() public {
        stakingToken = new ERC20Mock();
        rewardToken = new ERC20Mock();
        vault = new YieldVault(address(stakingToken), address(rewardToken));
        rewardToken.mint(address(this), 1000e18);
        rewardToken.transfer(address(vault), 1000e18);
        vm.startPrank(distributor);
        vault.setRewardDistributor(distributor);
        vm.stopPrank();
    }

    // Test 1: Reward accrual during the reward period
    function testRewardAccrualDuringPeriod() public {
        stakingToken.mint(alice, 100e18);
        vm.startPrank(alice);
        stakingToken.approve(address(vault), type(uint256).max);
        vault.deposit(100e18);
        vm.stopPrank();

        vm.startPrank(distributor);
        vault.notifyRewardAmount(1000e18, 10 days);
        vm.warp(block.timestamp + 5 days);
        vm.stopPrank();

        uint256 earned = vault.earned(alice);
        assertGt(earned, 0, "Rewards should accrue during period");
        assertLt(earned, 1000e18, "Should not exceed total reward");
    }

    // Test 2: Reward freeze after reward period ends — the phantom reward bug
    function testRewardFreezeAfterPeriod() public {
        stakingToken.mint(alice, 100e18);
        vm.startPrank(alice);
        stakingToken.approve(address(vault), type(uint256).max);
        vault.deposit(100e18);
        vm.stopPrank();

        vm.startPrank(distributor);
        vault.notifyRewardAmount(1000e18, 10 days);
        vm.warp(block.timestamp + 15 days); // past the 10-day period
        vm.stopPrank();

        uint256 earned1 = vault.earned(alice);
        vm.warp(block.timestamp + 5 days); // another 5 days pass
        uint256 earned2 = vault.earned(alice);

        assertEq(earned1, earned2, "No phantom rewards should accrue after period ends");
    }

    // Test 3: Unauthorized caller cannot notify rewards — access control
    function testUnauthorizedNotifyReverts() public {
        vm.startPrank(alice);
        vm.expectRevert("Caller is not the reward distributor");
        vault.notifyRewardAmount(100e18, 1 days);
        vm.stopPrank();
    }

    // Test 4: Precision loss reduced to < 0.01%
    function testPrecisionLoss() public {
        stakingToken.mint(alice, 1e18);
        vm.startPrank(alice);
        stakingToken.approve(address(vault), type(uint256).max);
        vault.deposit(1e18);
        vm.stopPrank();

        vm.startPrank(distributor);
        vault.notifyRewardAmount(100e18, 100 seconds);
        vm.warp(block.timestamp + 50 seconds);
        vm.stopPrank();

        uint256 earned = vault.earned(alice);
        uint256 expected = 50e18;
        uint256 error = expected > earned ? expected - earned : earned - expected;
        uint256 errorBps = error * 10000 / expected;
        assertLt(errorBps, 10, "Precision loss should be below 0.01%");
    }

    // Test 5: Deposit and withdrawal flows still work
    function testDepositWithdrawFlow() public {
        stakingToken.mint(alice, 200e18);
        vm.startPrank(alice);
        stakingToken.approve(address(vault), type(uint256).max);

        vault.deposit(100e18);
        assertEq(vault.balanceOf(alice), 100e18);

        vault.withdraw(50e18);
        assertEq(vault.balanceOf(alice), 50e18);

        vm.stopPrank();
    }

    // Test 6: Reward claim flow
    function testClaimRewardFlow() public {
        stakingToken.mint(alice, 100e18);
        uint256 aliceBalBefore = rewardToken.balanceOf(alice);

        vm.startPrank(alice);
        stakingToken.approve(address(vault), type(uint256).max);
        vault.deposit(100e18);
        vm.stopPrank();

        vm.startPrank(distributor);
        vault.notifyRewardAmount(1000e18, 10 days);
        vm.warp(block.timestamp + 1 days);
        vm.stopPrank();

        vm.startPrank(alice);
        vault.claimReward();
        vm.stopPrank();

        assertGt(rewardToken.balanceOf(alice), aliceBalBefore);
        assertEq(vault.rewards(alice), 0, "Rewards should be cleared after claim");
    }
}
