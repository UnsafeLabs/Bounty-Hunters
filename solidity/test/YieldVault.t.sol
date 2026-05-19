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
        assertGt(earned, 0);
        assertLt(earned, 1000e18);
    }

    function testRewardFreezeAfterPeriod() public {
        stakingToken.mint(alice, 100e18);
        vm.startPrank(alice);
        stakingToken.approve(address(vault), type(uint256).max);
        vault.deposit(100e18);
        vm.stopPrank();
        vm.startPrank(distributor);
        vault.notifyRewardAmount(1000e18, 10 days);
        vm.warp(block.timestamp + 15 days);
        vm.stopPrank();
        uint256 earned1 = vault.earned(alice);
        vm.warp(block.timestamp + 5 days);
        uint256 earned2 = vault.earned(alice);
        assertEq(earned1, earned2, "Phantom rewards must be zero after period");
    }

    function testUnauthorizedNotifyReverts() public {
        vm.startPrank(alice);
        vm.expectRevert("Caller is not the reward distributor");
        vault.notifyRewardAmount(100e18, 1 days);
        vm.stopPrank();
    }

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
        assertLt(error * 10000 / expected, 10, "Precision loss below 0.01%");
    }

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

    function testClaimRewardFlow() public {
        stakingToken.mint(alice, 100e18);
        uint256 bal = rewardToken.balanceOf(alice);
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
        assertGt(rewardToken.balanceOf(alice), bal);
        assertEq(vault.rewards(alice), 0);
    }
}
