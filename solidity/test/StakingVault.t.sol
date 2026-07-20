// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/StakingVault.sol";

contract StakingVaultTest is Test {
    StakingVault vault;
    address user = address(0x1);
    address attacker = address(0x2);

    function setUp() public {
        vault = new StakingVault(address(0), 100);
        vm.deal(address(vault), 100 ether);
        vm.deal(user, 10 ether);
        vm.deal(attacker, 10 ether);
    }

    function testWithdrawUpdatesStateBeforeExternalCall() public {
        vm.prank(user);
        vault.stake{value: 1 ether}(1 ether);

        vm.prank(user);
        vault.withdraw(1 ether);

        assertEq(vault.getStakedBalance(user), 0);
    }

    function testClaimRewardsUpdatesStateBeforeExternalCall() public {
        vm.prank(user);
        vault.stake{value: 1 ether}(1 ether);

        vm.warp(block.timestamp + 100);

        vm.prank(user);
        vault.claimRewards();

        assertEq(vault.getPendingRewards(user), 0);
    }

    function testReentrancyOnWithdraw() public {
        ReentrancyAttacker ra = new ReentrancyAttacker(vault);
        vm.deal(address(ra), 10 ether);

        ra.stakeAndWithdraw();

        assertEq(vault.getStakedBalance(address(ra)), 0);
    }
}

contract ReentrancyAttacker {
    StakingVault public vault;
    uint256 public stakeAmount = 1 ether;
    bool public attacked;

    constructor(StakingVault _vault) {
        vault = _vault;
    }

    function stakeAndWithdraw() external {
        vault.stake{value: stakeAmount}(stakeAmount);
        vault.withdraw(stakeAmount);
    }

    receive() external payable {
        if (!attacked && address(vault).balance > 0) {
            attacked = true;
            vault.withdraw(stakeAmount);
        }
    }
}
