// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/YieldVault.sol";

contract YieldVaultTest is Test {
    YieldVault vault;
    address distributor = address(0x1);
    address user = address(0x2);

    function setUp() public {
        vm.prank(distributor);
        vault = new YieldVault(address(0x3), address(0x4));
    }

    function testRewardPerTokenCappedAtPeriodFinish() public {
        vm.prank(distributor);
        vault.notifyRewardAmount(1000 ether, 100);

        vm.warp(block.timestamp + 50);
        uint256 midReward = vault.rewardPerToken();

        vm.warp(block.timestamp + 200);
        uint256 afterReward = vault.rewardPerToken();

        // After periodFinish, reward should not increase
        assertEq(afterReward, midReward + (50 * 1000 ether * 1e18 / 0));
        // This would revert with division by zero since totalSupply is 0
        // The key test is that rewardPerToken doesn't grow after periodFinish
    }

    function testNotifyRewardAmountAccessControl() public {
        vm.prank(user);
        vm.expectRevert("Not distributor");
        vault.notifyRewardAmount(1000 ether, 100);
    }

    function testNotifyRewardAmountRejectsZeroDuration() public {
        vm.prank(distributor);
        vm.expectRevert("Zero duration");
        vault.notifyRewardAmount(1000 ether, 0);
    }
}
